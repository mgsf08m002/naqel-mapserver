"""Shared helpers for the live Riyadh road network (PostGIS + MVT tiles)."""

from __future__ import annotations

import time
from typing import Any

from django.conf import settings

from .riyadh_fclass import riyadh_fclass_for_persistence


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


def network_mutation_payload(**fields: Any) -> dict[str, Any]:
    """
    Standard JSON fields every live riyadh_roads mutation should return.

    Always includes tiles_version; optional remote_road_id, fclass, deleted_road_id.
    """
    payload: dict[str, Any] = {"tiles_version": tiles_version_ms()}
    for key, value in fields.items():
        if value is not None:
            payload[key] = value
    return payload
