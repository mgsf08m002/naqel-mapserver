import json

from django.contrib.auth.decorators import login_required
from django.contrib.sessions.models import Session
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from config.api_errors import json_api_error
from config.ui_strings import t
from security.models import UserSession
from security.session_meta import (
    browser_display_name,
    browser_has_icon,
    delete_user_session_record,
    delete_user_session_records_for_keys,
    detect_browser,
    detect_device_type,
    detect_os,
    sync_user_session_record,
)

_DEVICE_LABEL_KEYS = {
    UserSession.DeviceType.DESKTOP: "sec_device_desktop",
    UserSession.DeviceType.MOBILE: "sec_device_mobile",
    UserSession.DeviceType.TABLET: "sec_device_tablet",
    UserSession.DeviceType.UNKNOWN: "sec_device_unknown",
}


def _iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _ui_lang(request) -> str:
    return getattr(request, "ui_language", None) or "en"


def _device_type_label(device_type: str, lang: str) -> str:
    key = _DEVICE_LABEL_KEYS.get(device_type, "sec_device_unknown")
    return t(lang, key)


def _location_label(raw: str, lang: str) -> str:
    label = (raw or "").strip()
    if not label:
        return ""
    if label == "Unknown location":
        return t(lang, "sec_location_unknown")
    if label == "Local network":
        return t(lang, "sec_location_local")
    return label


def _browser_label(browser: str, lang: str) -> str:
    if not browser or browser == "other":
        return t(lang, "sec_unknown_browser")
    return browser_display_name(browser)


def _session_payload(
    *,
    django_session,
    record: UserSession | None,
    is_current: bool,
    lang: str,
) -> dict:
    data = django_session.get_decoded()
    ua = (record.user_agent if record else "") or data.get("user_agent", "") or ""
    ip = (record.client_ip if record else "") or data.get("client_ip", "") or ""
    browser = (record.browser if record else "") or detect_browser(ua)
    os_name = (record.os_name if record else "") or detect_os(ua)
    device_type = (record.device_type if record else "") or detect_device_type(ua)
    created_at = _iso(record.created_at if record else data.get("session_created_at"))
    last_seen_at = _iso(
        record.last_seen_at
        if record
        else (data.get("last_seen_at") or data.get("session_created_at"))
    )
    location = (record.location_label if record else "") or ""

    return {
        "session_key": django_session.session_key,
        "is_current": is_current,
        "ip_address": ip,
        "browser": browser,
        "browser_label": _browser_label(browser, lang),
        "browser_has_icon": browser_has_icon(browser),
        "os_name": os_name,
        "device_type_label": _device_type_label(device_type, lang),
        "location_label": _location_label(location, lang),
        "created_at": created_at,
        "last_seen_at": last_seen_at,
    }


def _owned_active_sessions(user):
    now = timezone.now()
    rows = []
    for session in Session.objects.filter(expire_date__gte=now):
        data = session.get_decoded()
        if str(data.get("_auth_user_id")) != str(user.id):
            continue
        rows.append(session)
    return rows


@login_required(login_url="/login/")
@require_http_methods(["GET"])
def active_sessions_api(request):
    """Return enriched active sessions for the authenticated user."""
    try:
        # Keep the current session row fresh before listing.
        sync_user_session_record(request)

        lang = _ui_lang(request)
        current_key = request.session.session_key
        owned = _owned_active_sessions(request.user)
        records = {
            row.session_key: row
            for row in UserSession.objects.filter(
                user=request.user,
                session_key__in=[s.session_key for s in owned],
            )
        }

        active_sessions = [
            _session_payload(
                django_session=session,
                record=records.get(session.session_key),
                is_current=session.session_key == current_key,
                lang=lang,
            )
            for session in owned
        ]

        current = [s for s in active_sessions if s["is_current"]]
        others = [s for s in active_sessions if not s["is_current"]]
        others.sort(key=lambda s: s["last_seen_at"] or "", reverse=True)
        active_sessions = current + others

        return JsonResponse({"success": True, "sessions": active_sessions})
    except Exception as exc:
        return json_api_error(
            request,
            exc=exc,
            status=500,
            message_key="toast_couldnt_load_sessions",
            extra={"sessions": []},
        )


@login_required(login_url="/login/")
@require_http_methods(["POST"])
def terminate_session_api(request):
    """Terminate one session belonging to the authenticated user."""
    try:
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse(
                {
                    "success": False,
                    "message": t(_ui_lang(request), "toast_invalid_json"),
                },
                status=400,
            )

        session_key = payload.get("session_key")
        if not session_key:
            return JsonResponse(
                {
                    "success": False,
                    "message": t(_ui_lang(request), "msg_sec_session_key_required"),
                },
                status=400,
            )

        try:
            target_session = Session.objects.get(session_key=session_key)
        except Session.DoesNotExist:
            delete_user_session_record(session_key)
            return JsonResponse(
                {
                    "success": True,
                    "session_terminated": True,
                    "current_session_terminated": False,
                }
            )

        data = target_session.get_decoded()
        if str(data.get("_auth_user_id")) != str(request.user.id):
            return JsonResponse(
                {
                    "success": False,
                    "message": t(_ui_lang(request), "msg_sec_terminate_forbidden"),
                },
                status=403,
            )

        is_current_session = session_key == request.session.session_key
        target_session.delete()
        delete_user_session_record(session_key)

        return JsonResponse(
            {
                "success": True,
                "session_terminated": True,
                "current_session_terminated": is_current_session,
            }
        )
    except Exception as exc:
        return json_api_error(
            request,
            exc=exc,
            status=500,
            message_key="toast_refresh_try_again",
        )


@login_required(login_url="/login/")
@require_http_methods(["POST"])
def terminate_other_sessions_api(request):
    """Sign out every other active session for the authenticated user."""
    try:
        current_key = request.session.session_key
        ended_keys = []
        for session in _owned_active_sessions(request.user):
            if session.session_key == current_key:
                continue
            ended_keys.append(session.session_key)
            session.delete()

        delete_user_session_records_for_keys(ended_keys)

        return JsonResponse(
            {
                "success": True,
                "sessions_terminated": len(ended_keys),
            }
        )
    except Exception as exc:
        return json_api_error(
            request,
            exc=exc,
            status=500,
            message_key="toast_refresh_try_again",
        )
