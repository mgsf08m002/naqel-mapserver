from django.contrib.auth.decorators import login_required
from django.contrib.sessions.models import Session
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods
import json


def _get_client_ip(request):
    """Best-effort client IP extraction without adding external dependencies."""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        # X-Forwarded-For may contain multiple IPs, take the first one
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR") or ""


def _detect_browser(user_agent: str) -> str:
    """Map a user agent string to a simple browser identifier."""
    ua = (user_agent or "").lower()

    if "edg" in ua:
        return "edge"
    if "opr" in ua or "opera" in ua:
        return "opera"
    if "chrome" in ua and "chromium" not in ua:
        return "chrome"
    if "firefox" in ua:
        return "firefox"
    if "safari" in ua and "chrome" not in ua:
        return "safari"
    return "other"


@login_required(login_url="/login/")
@require_http_methods(["GET"])
def active_sessions_api(request):
    """
    Return all active sessions for the currently authenticated user.

    A session is considered active if:
    - It has not expired.
    - Its decoded data links to the same authenticated user.
    """
    try:
        user = request.user
        now = timezone.now()
        sessions_qs = Session.objects.filter(expire_date__gte=now)

        active_sessions = []
        current_session_key = request.session.session_key

        for session in sessions_qs:
            data = session.get_decoded()
            if str(data.get("_auth_user_id")) != str(user.id):
                continue

            # Metadata captured at login and/or via middleware
            client_ip = data.get("client_ip", "")
            user_agent = data.get("user_agent", "")
            created_at = data.get("session_created_at")
            last_seen_at = data.get("last_seen_at", created_at)

            browser = _detect_browser(user_agent)

            active_sessions.append(
                {
                    "session_key": session.session_key,
                    "is_current": session.session_key == current_session_key,
                    "ip_address": client_ip,
                    "user_agent": user_agent,
                    "browser": browser,
                    "created_at": created_at,
                    "last_seen_at": last_seen_at,
                }
            )

        # Sort with current session first, then by most recent activity
        active_sessions.sort(
            key=lambda s: (
                not s["is_current"],
                (s["last_seen_at"] or ""),
            )
        )

        return JsonResponse(
            {
                "success": True,
                "sessions": active_sessions,
            }
        )
    except Exception as exc:
        return JsonResponse(
            {
                "success": False,
                "message": str(exc),
            },
            status=500,
        )


@login_required(login_url="/login/")
@require_http_methods(["POST"])
def terminate_session_api(request):
    """
    Terminate a specific session belonging to the currently authenticated user.

    The caller must provide the target session key in the request body:
    {"session_key": "<session_key>"}.
    """
    try:
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse(
                {
                    "success": False,
                    "message": "Invalid JSON data.",
                },
                status=400,
            )

        session_key = payload.get("session_key")
        if not session_key:
            return JsonResponse(
                {
                    "success": False,
                    "message": "Session key is required.",
                },
                status=400,
            )

        # Ensure the session exists and belongs to the current user
        try:
            target_session = Session.objects.get(session_key=session_key)
        except Session.DoesNotExist:
            # If the session is already gone treat it as successfully terminated
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
                    "message": "You are not allowed to terminate this session.",
                },
                status=403,
            )

        is_current_session = session_key == request.session.session_key
        target_session.delete()

        response_payload = {
            "success": True,
            "session_terminated": True,
            "current_session_terminated": is_current_session,
        }

        return JsonResponse(response_payload)
    except Exception as exc:
        return JsonResponse(
            {
                "success": False,
                "message": str(exc),
            },
            status=500,
        )

