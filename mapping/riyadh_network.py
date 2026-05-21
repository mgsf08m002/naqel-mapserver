"""Shared helpers for the live Riyadh road network (PostGIS + MVT tiles)."""

import time

from django.conf import settings


def tiles_version_ms() -> int:
    """Millisecond timestamp for MVT cache-busting after network mutations."""
    return int(time.time_ns() // 1_000_000)


def riyadh_tile_proxy_absolute_url(request) -> str:
    """Absolute Django proxy URL template for MapLibre ({z}/{x}/{y} placeholders)."""
    if not getattr(settings, "RIYADH_ROADS_TILE_URL", "").strip():
        return ""
    return (
        f"{request.scheme}://{request.get_host()}"
        "/mapping/tiles/riyadh_roads/{z}/{x}/{y}/"
    )
