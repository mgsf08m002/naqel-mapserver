"""Authorization decisions for Nginx ``auth_request`` tile checks."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.db import connection
from django.utils import timezone

from .models import TileAccessToken, TileLayer, TileUsageDaily, hash_token

logger = logging.getLogger(__name__)

# Must stay in sync with the tile location regex in geo-infra/nginx/templates/geotrak.conf.template
TILE_PATH_RE = re.compile(
    r"^/tiles/(?P<source>[A-Za-z0-9_]+)/\d+/\d+/\d+(?:\.pbf|\.mvt)?$"
)
LAST_USED_RESOLUTION = timedelta(seconds=60)
MAP_ROLES = {"manager", "editor"}


@dataclass(frozen=True)
class TileDecision:
    status: int  # 204 allow, 401 no credentials, 403 refused
    reason: str
    token_label: str = "-"  # logged by Nginx as tile_token=...

    @property
    def allowed(self) -> bool:
        return self.status == 204


def parse_original_uri(original_uri: str) -> tuple[str | None, str]:
    """Return ``(source, query_string)`` for a /tiles/... URI, or ``(None, "")``."""
    parts = urlsplit(original_uri or "")
    match = TILE_PATH_RE.match(parts.path)
    if not match:
        return None, ""
    return match.group("source"), parts.query


def extract_raw_token(request, query_string: str) -> str:
    """Token from ?token=, X-Tile-Token, or ``Authorization: Bearer``. Empty when absent."""
    values = parse_qs(query_string).get("token")
    if values and values[0].strip():
        return values[0].strip()
    header = request.headers.get("X-Tile-Token", "").strip()
    if header:
        return header
    auth = request.headers.get("Authorization", "")
    scheme, _, value = auth.partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return value.strip()
    return ""


def user_may_view_tiles(user) -> bool:
    """GeoTrak web-map users: system admins, managers, and editors."""
    if not user or not user.is_authenticated or not user.is_active:
        return False
    if user.is_superuser:
        return True
    profile = getattr(user, "profile", None)
    return bool(profile and profile.role in MAP_ROLES)


def record_usage(*, layer: TileLayer, token: TileAccessToken | None = None, user=None) -> None:
    """Increment today's counter in one atomic upsert. Failures never block tiles."""
    table = TileUsageDaily._meta.db_table
    now = timezone.now()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {table} (date, layer_id, token_id, user_id, request_count, last_request_at)
                VALUES (%s, %s, %s, %s, 1, %s)
                ON CONFLICT ON CONSTRAINT tile_usage_daily_unique
                DO UPDATE SET request_count = {table}.request_count + 1,
                              last_request_at = EXCLUDED.last_request_at
                """,
                [
                    timezone.localdate(now),
                    layer.pk,
                    token.pk if token else None,
                    user.pk if user else None,
                    now,
                ],
            )
    except Exception:  # pragma: no cover - logging must not take tiles down
        logger.exception("Could not record tile usage for layer %s", layer.slug)


def _touch_last_used(token: TileAccessToken) -> None:
    now = timezone.now()
    if token.last_used_at is None or now - token.last_used_at >= LAST_USED_RESOLUTION:
        TileAccessToken.objects.filter(pk=token.pk).update(last_used_at=now)


def authorize_tile_request(request, original_uri: str) -> TileDecision:
    """Decide whether the tile in ``original_uri`` may be served to this request."""
    source, query_string = parse_original_uri(original_uri)
    if source is None:
        return TileDecision(403, "malformed tile path")

    layer = TileLayer.objects.filter(slug=source, is_active=True).first()
    if layer is None:
        return TileDecision(403, f"unknown or inactive layer '{source}'")

    raw_token = extract_raw_token(request, query_string)
    if raw_token:
        token = TileAccessToken.objects.filter(token_hash=hash_token(raw_token)).first()
        if token is None:
            return TileDecision(403, "unknown token")
        if token.is_revoked:
            return TileDecision(403, "token revoked", token.token_prefix)
        if token.is_expired:
            return TileDecision(403, "token expired", token.token_prefix)
        if not token.layers.filter(pk=layer.pk).exists():
            return TileDecision(403, f"token not allowed for '{source}'", token.token_prefix)
        _touch_last_used(token)
        record_usage(layer=layer, token=token)
        return TileDecision(204, "token", token.token_prefix)

    user = getattr(request, "user", None)
    if layer.allow_session_access and user_may_view_tiles(user):
        if getattr(settings, "TILE_ACCESS_LOG_SESSION_USAGE", True):
            record_usage(layer=layer, user=user)
        return TileDecision(204, "session", "session")

    if layer.allow_anonymous_access:
        record_usage(layer=layer)
        return TileDecision(204, "anonymous", "anonymous")

    return TileDecision(401, "no credentials")
