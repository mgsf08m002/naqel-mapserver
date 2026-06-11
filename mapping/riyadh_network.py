"""Shared helpers for the live Riyadh road network (PostGIS + MVT tiles)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.cache import cache

from .riyadh_fclass import riyadh_fclass_for_persistence

RIYADH_TILES_VERSION_CACHE_KEY = "riyadh_roads_tiles_version"


def tiles_version_ms() -> int:
    """Millisecond timestamp for MVT cache-busting after network mutations."""
    return int(time.time_ns() // 1_000_000)


def publish_riyadh_tiles_version() -> int:
    """Record a new global tiles version after any riyadh_roads mutation."""
    version = tiles_version_ms()
    cache.set(RIYADH_TILES_VERSION_CACHE_KEY, version, timeout=None)
    return version


def current_riyadh_tiles_version() -> int:
    """Latest published tiles version (for cross-app polling)."""
    cached = cache.get(RIYADH_TILES_VERSION_CACHE_KEY)
    if cached is not None:
        return int(cached)
    return publish_riyadh_tiles_version()


def symbology_sync_version_ms() -> int:
    """Version stamp for symbology.json / labeling.json used by companion map apps."""
    stamps: list[int] = []
    base = Path(settings.BASE_DIR)
    for rel in ("symbology/symbology.json", "symbology/labeling.json"):
        path = base / rel
        if path.is_file():
            stamps.append(int(path.stat().st_mtime * 1000))
    try:
        from symbology.catalog_service import get_catalog

        catalog_version = get_catalog().get("version")
        if catalog_version is not None:
            stamps.append(int(catalog_version))
    except Exception:
        pass
    return max(stamps) if stamps else 0


def riyadh_map_sync_payload() -> dict[str, int]:
    """Public sync payload for naqel-map / GEOTRAK polling."""
    return {
        "tiles_version": current_riyadh_tiles_version(),
        "symbology_version": symbology_sync_version_ms(),
    }


def riyadh_tile_proxy_absolute_url(request) -> str:
    """Absolute Django proxy URL template for MapLibre ({z}/{x}/{y} placeholders)."""
    if not getattr(settings, "RIYADH_ROADS_TILE_URL", "").strip():
        return ""
    return (
        f"{request.scheme}://{request.get_host()}"
        "/mapping/tiles/riyadh_roads/{z}/{x}/{y}/"
    )


def normalize_published_fclass(raw: str | None) -> str:
    """Return a lowercase fclass slug for MVT symbology (never empty)."""
    value = (raw or "").strip().lower()
    return value or "unclassified"


def published_fclass_from_edit_request(edit_request) -> str:
    """Resolve fclass for API responses after a road edit is published."""
    if not edit_request:
        return "unclassified"

    fields_data = (
        edit_request.fields_data if isinstance(edit_request.fields_data, dict) else {}
    )
    raw = (fields_data.get("fclass") or "").strip().lower()
    if raw:
        return normalize_published_fclass(raw)

    derived = riyadh_fclass_for_persistence(
        edit_request.current_feature_label or edit_request.feature_type
    )
    return normalize_published_fclass(derived)


def live_mutation_flags(
    *,
    geometry_changed: bool = False,
    closure_applied: bool = False,
) -> dict[str, bool]:
    """Client map hints: geometry needs MVT reload; closure uses feature-state only."""
    return {
        "geometry_changed": bool(geometry_changed),
        "closure_applied": bool(closure_applied),
    }


def network_mutation_payload(**fields: Any) -> dict[str, Any]:
    """
    Standard JSON fields every live riyadh_roads mutation should return.

    Always includes tiles_version; optional remote_road_id, fclass, deleted_road_id.
    Pair with live_mutation_flags() for geometry_changed / closure_applied.
    """
    payload: dict[str, Any] = {"tiles_version": publish_riyadh_tiles_version()}
    for key, value in fields.items():
        if value is not None:
            payload[key] = value
    return payload
