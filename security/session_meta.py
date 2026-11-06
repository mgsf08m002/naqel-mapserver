"""Shared session metadata helpers for Active Sessions."""

from __future__ import annotations

import ipaddress
import json
import logging
import urllib.error
import urllib.request
from datetime import timedelta

from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from security.models import UserSession

logger = logging.getLogger(__name__)

USER_AGENT_MAX_LEN = 512
LAST_SEEN_MIN_INTERVAL = timedelta(seconds=60)
IP_UA_REFRESH_INTERVAL = timedelta(minutes=5)
LOCATION_REFRESH_INTERVAL = timedelta(hours=12)
LOCATION_HTTP_TIMEOUT = 1.5

ICON_BROWSERS = frozenset(
    {"chrome", "edge", "firefox", "opera", "safari", "brave", "samsung", "chromium"}
)

_BROWSER_LABELS = {
    "chrome": "Chrome",
    "edge": "Edge",
    "firefox": "Firefox",
    "opera": "Opera",
    "safari": "Safari",
    "brave": "Brave",
    "samsung": "Samsung Internet",
    "chromium": "Chromium",
    "other": "Unknown browser",
}

def get_client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or ""
    return (request.META.get("REMOTE_ADDR") or "").strip()


def get_user_agent(request) -> str:
    return (request.META.get("HTTP_USER_AGENT") or "")[:USER_AGENT_MAX_LEN]


def detect_browser(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if not ua:
        return "other"
    if "edg/" in ua or "edgios" in ua or "edga/" in ua:
        return "edge"
    if "opr/" in ua or "opera" in ua:
        return "opera"
    if "brave" in ua:
        return "brave"
    if "samsungbrowser" in ua:
        return "samsung"
    if "firefox/" in ua or "fxios/" in ua:
        return "firefox"
    if "chrome/" in ua or "crios/" in ua:
        return "chrome"
    if "chromium" in ua:
        return "chromium"
    if "safari/" in ua and "chrome" not in ua and "chromium" not in ua:
        return "safari"
    return "other"


def browser_display_name(browser_key: str) -> str:
    return _BROWSER_LABELS.get((browser_key or "other").lower(), _BROWSER_LABELS["other"])


def browser_has_icon(browser_key: str) -> bool:
    return (browser_key or "").lower() in ICON_BROWSERS


def detect_os(user_agent: str) -> str:
    ua = user_agent or ""
    low = ua.lower()
    if not low:
        return "Unknown OS"
    if "android" in low:
        return "Android"
    if "iphone" in low or "ipad" in low or "ipod" in low or "ios" in low:
        return "iOS"
    if "mac os x" in low or "macintosh" in low:
        return "macOS"
    if "windows nt 10" in low or "windows nt 11" in low:
        return "Windows"
    if "windows" in low:
        return "Windows"
    if "cros" in low:
        return "Chrome OS"
    if "linux" in low:
        return "Linux"
    return "Unknown OS"


def detect_device_type(user_agent: str) -> str:
    low = (user_agent or "").lower()
    if not low:
        return UserSession.DeviceType.UNKNOWN
    if "ipad" in low or ("android" in low and "mobile" not in low) or "tablet" in low:
        return UserSession.DeviceType.TABLET
    if (
        "mobi" in low
        or "iphone" in low
        or "ipod" in low
        or "android" in low
        or "windows phone" in low
    ):
        return UserSession.DeviceType.MOBILE
    return UserSession.DeviceType.DESKTOP


def _is_private_ip(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_private or ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return True


def resolve_approx_location(ip: str) -> str:
    """Best-effort city/country label. Never raises; safe for request path."""
    ip = (ip or "").strip()
    if not ip:
        return "Unknown location"
    if _is_private_ip(ip):
        return "Local network"

    url = f"http://ip-api.com/json/{ip}?fields=status,country,city,message"
    try:
        with urllib.request.urlopen(url, timeout=LOCATION_HTTP_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        logger.debug("location lookup failed for %s: %s", ip, exc)
        return "Unknown location"

    if payload.get("status") != "success":
        return "Unknown location"
    city = (payload.get("city") or "").strip()
    country = (payload.get("country") or "").strip()
    if city and country:
        return f"{city}, {country}"
    return country or city or "Unknown location"


def _parse_iso(value: str | None):
    if not value:
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.utc)
    return parsed


def _stale(previous_iso: str | None, interval: timedelta) -> bool:
    previous = _parse_iso(previous_iso)
    if previous is None:
        return True
    return timezone.now() - previous >= interval


def _dt_stale(previous, interval: timedelta) -> bool:
    if previous is None:
        return True
    if timezone.is_naive(previous):
        previous = timezone.make_aware(previous, timezone.utc)
    return timezone.now() - previous >= interval


def _ensure_session_key(request) -> str | None:
    if not request.session.session_key:
        request.session.save()
    return request.session.session_key


def sync_user_session_record(request, *, force_location: bool = False) -> None:
    """Upsert the UserSession row for the current request session."""
    user = getattr(request, "user", None)
    if user is None or isinstance(user, AnonymousUser) or not user.is_authenticated:
        return

    session_key = _ensure_session_key(request)
    if not session_key:
        return

    session = request.session
    ip = session.get("client_ip") or get_client_ip(request)
    ua = session.get("user_agent") or get_user_agent(request)
    browser = detect_browser(ua)
    os_name = detect_os(ua)
    device_type = detect_device_type(ua)
    created_at = _parse_iso(session.get("session_created_at")) or timezone.now()
    last_seen_at = _parse_iso(session.get("last_seen_at")) or timezone.now()

    record, _created = UserSession.objects.get_or_create(
        session_key=session_key,
        defaults={
            "user": user,
            "client_ip": ip,
            "user_agent": ua,
            "browser": browser,
            "os_name": os_name,
            "device_type": device_type,
            "created_at": created_at,
            "last_seen_at": last_seen_at,
        },
    )

    ip_changed = bool(ip) and record.client_ip != ip
    needs_location = force_location or not record.location_label or ip_changed or _dt_stale(
        record.location_resolved_at,
        LOCATION_REFRESH_INTERVAL,
    )

    record.user = user
    record.client_ip = ip
    record.user_agent = ua
    record.browser = browser
    record.os_name = os_name
    record.device_type = device_type
    record.created_at = min(record.created_at, created_at) if record.created_at else created_at
    record.last_seen_at = last_seen_at

    if needs_location:
        record.location_label = resolve_approx_location(ip)
        record.location_resolved_at = timezone.now()

    record.save()


def stamp_session_metadata(request, *, force: bool = False) -> None:
    """Write IP / UA / timestamps onto the Django session and sync UserSession."""
    session = request.session
    now_iso = timezone.now().isoformat()
    ip = get_client_ip(request)
    ua = get_user_agent(request)

    if force or not session.get("client_ip"):
        session["client_ip"] = ip
    if force or not session.get("user_agent"):
        session["user_agent"] = ua
    if "session_created_at" not in session:
        session["session_created_at"] = now_iso

    session["last_seen_at"] = now_iso
    session["session_meta_refreshed_at"] = now_iso
    _ensure_session_key(request)
    sync_user_session_record(request, force_location=force)


def touch_session_activity(request) -> None:
    """Throttled activity + identity refresh, then sync UserSession when writing."""
    session = request.session
    now_iso = timezone.now().isoformat()

    if "session_created_at" not in session:
        session["session_created_at"] = now_iso

    missing_ip = not session.get("client_ip")
    missing_ua = not session.get("user_agent")
    refresh_identity = missing_ip or missing_ua or _stale(
        session.get("session_meta_refreshed_at"),
        IP_UA_REFRESH_INTERVAL,
    )
    refresh_seen = _stale(session.get("last_seen_at"), LAST_SEEN_MIN_INTERVAL)

    if not refresh_identity and not refresh_seen:
        return

    if refresh_identity:
        session["client_ip"] = get_client_ip(request)
        session["user_agent"] = get_user_agent(request)
        session["session_meta_refreshed_at"] = now_iso

    if refresh_seen or refresh_identity:
        session["last_seen_at"] = now_iso

    _ensure_session_key(request)
    sync_user_session_record(request, force_location=refresh_identity)


def delete_user_session_record(session_key: str | None) -> None:
    if not session_key:
        return
    UserSession.objects.filter(session_key=session_key).delete()


def delete_user_session_records_for_keys(session_keys: list[str]) -> None:
    if not session_keys:
        return
    UserSession.objects.filter(session_key__in=session_keys).delete()
