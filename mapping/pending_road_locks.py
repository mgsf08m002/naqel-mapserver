"""Pending-review locks until a LineEditRequest is approved or rejected."""

from __future__ import annotations

import json
import logging
from typing import Any

from django.contrib.gis.geos import GEOSGeometry

from .models import LineEditRequest

logger = logging.getLogger(__name__)

PENDING_ROAD_LOCK_MESSAGE = "This road is waiting for review"

PENDING_ROAD_DELETE_LOCK_MESSAGE = "This road is waiting for review"

PENDING_NEW_ROAD_LOCK_MESSAGE = "A new road on this path is waiting for review"

# Same-path only: corridor around the pending line + minimum shared length fraction.
PENDING_NEW_ROAD_CORRIDOR_M = 3.0
PENDING_NEW_ROAD_OVERLAP_FRACTION = 0.55


def _candidate_ids_for_road(road, fallback_id: int | None = None) -> set[int]:
    """Tile ``id`` and/or ``gid`` values that may refer to the same road."""
    ids: set[int] = set()
    if fallback_id is not None:
        try:
            ids.add(int(fallback_id))
        except (TypeError, ValueError):
            pass
    if road is None:
        return ids
    for raw in (getattr(road, "id", None), getattr(road, "gid", None)):
        if raw is None:
            continue
        try:
            ids.add(int(float(raw)))
        except (TypeError, ValueError):
            continue
    return ids


def find_pending_edit_for_riyadh_road(riyadh_road_id, road=None) -> LineEditRequest | None:
    """First pending request that locks this existing network road, if any."""
    if riyadh_road_id is None and road is None:
        return None
    try:
        fallback = int(riyadh_road_id) if riyadh_road_id is not None else None
    except (TypeError, ValueError):
        fallback = None
    candidates = _candidate_ids_for_road(road, fallback)
    if not candidates:
        return None
    return (
        LineEditRequest.objects.filter(
            status="pending",
            is_riyadh_road=True,
            riyadh_road_id__in=sorted(candidates),
        )
        .order_by("id")
        .first()
    )


def pending_edit_blocks_reviewable_change(
    *,
    riyadh_road_id,
    road=None,
    geometry_changed: bool,
    needs_manager_review: bool,
) -> LineEditRequest | None:
    """Block another reviewable edit; closure-only updates stay allowed."""
    if not geometry_changed and not needs_manager_review:
        return None
    return find_pending_edit_for_riyadh_road(riyadh_road_id, road=road)


def _coerce_line_geometry(value: Any) -> dict[str, Any] | None:
    """Normalize to a WGS84 LineString / MultiLineString dict for map highlight."""
    if value is None:
        return None

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return None

    if not isinstance(value, dict):
        return None

    geom = value
    gtype = geom.get("type")
    if gtype == "Feature":
        geom = geom.get("geometry")
        if not isinstance(geom, dict):
            return None
        gtype = geom.get("type")
    elif gtype == "FeatureCollection":
        features = geom.get("features") or []
        first = features[0] if features else None
        if not isinstance(first, dict):
            return None
        geom = first.get("geometry") if first.get("type") == "Feature" else first
        if not isinstance(geom, dict):
            return None
        gtype = geom.get("type")

    if gtype not in ("LineString", "MultiLineString") or not geom.get("coordinates"):
        return None

    try:
        from .views import _ensure_wgs84_geometry

        normalized = _ensure_wgs84_geometry(geom, source_srid=3857)
        if (
            isinstance(normalized, dict)
            and normalized.get("type") in ("LineString", "MultiLineString")
            and normalized.get("coordinates")
        ):
            return normalized
    except Exception:
        pass
    return geom


def _geos_line_mercator(geometry: dict[str, Any]) -> GEOSGeometry | None:
    """WGS84 line → EPSG:3857 for metre measurements."""
    try:
        geos = GEOSGeometry(json.dumps(geometry), srid=4326)
        if geos.empty:
            return None
        geos.transform(3857)
        return geos
    except Exception as exc:
        logger.debug("pending-new-road geos parse failed: %s", exc)
        return None


def _overlap_fraction_along_corridor(
    drawn: GEOSGeometry,
    pending: GEOSGeometry,
    *,
    corridor_m: float,
) -> float:
    """
    Fraction of ``drawn`` length that lies inside a corridor around ``pending``.

    Adjacent / parallel / nearby roads stay free; only same-path redraws score high.
    """
    try:
        drawn_len = float(drawn.length)
    except Exception:
        return 0.0
    if drawn_len <= 0:
        return 0.0
    try:
        corridor = pending.buffer(float(corridor_m))
        inter = drawn.intersection(corridor)
    except Exception:
        return 0.0
    if inter is None or inter.empty:
        return 0.0
    try:
        return max(0.0, min(1.0, float(inter.length) / drawn_len))
    except Exception:
        return 0.0


def find_pending_new_road_same_path(geometry) -> LineEditRequest | None:
    """Pending new-road request that shares the same path (adjacent draws stay free)."""
    candidate = _coerce_line_geometry(geometry)
    if not candidate:
        return None
    drawn = _geos_line_mercator(candidate)
    if drawn is None:
        return None

    qs = (
        LineEditRequest.objects.filter(status="pending", is_riyadh_road=False)
        .exclude(geometry__isnull=True)
        .order_by("id")
    )
    for req in qs.iterator():
        pending_geom = _coerce_line_geometry(req.geometry)
        if not pending_geom:
            continue
        pending = _geos_line_mercator(pending_geom)
        if pending is None:
            continue
        if (
            _overlap_fraction_along_corridor(
                drawn,
                pending,
                corridor_m=PENDING_NEW_ROAD_CORRIDOR_M,
            )
            >= PENDING_NEW_ROAD_OVERLAP_FRACTION
        ):
            return req
    return None


def serialize_pending_road_locks() -> dict[str, Any]:
    """
    Map highlight payload.

    ``roads``: existing network roads with a pending edit.
    ``new_roads``: drawn roads not yet on the network.
    """
    qs = LineEditRequest.objects.filter(status="pending").order_by("id")

    roads: list[dict[str, Any]] = []
    new_roads: list[dict[str, Any]] = []
    seen_road_ids: set[int] = set()

    for req in qs:
        category = (req.request_category or "").strip() or "road_attribute_edit"
        geometry = _coerce_line_geometry(req.geometry)
        original = _coerce_line_geometry(req.original_geometry)

        if req.is_riyadh_road and req.riyadh_road_id is not None:
            try:
                road_id = int(req.riyadh_road_id)
            except (TypeError, ValueError):
                continue
            if road_id in seen_road_ids:
                continue
            seen_road_ids.add(road_id)
            roads.append(
                {
                    "road_id": road_id,
                    "request_id": req.id,
                    "category": category,
                    "geometry": geometry or original,
                }
            )
            continue

        if not req.is_riyadh_road and geometry:
            new_roads.append(
                {
                    "request_id": req.id,
                    "category": category,
                    "geometry": geometry,
                }
            )

    return {"roads": roads, "new_roads": new_roads}
