"""JSON/GeoJSON builders for layer upload review APIs."""

from __future__ import annotations

import json
from typing import Iterable

from django.contrib.gis.db.models import Extent
from django.contrib.gis.geos import Polygon
from django.db.models import QuerySet

from .constants import (
    FEATURE_PROPERTY_ROWS_TABLE,
    GEOJSON_SMALL_LAYER_LIMIT,
    GEOJSON_VIEWPORT_LIMIT,
    LARGE_LAYER_FEATURE_THRESHOLD,
    TABLE_LIST_ALL_MAX,
    TABLE_PAGE_SIZE_DEFAULT,
    TABLE_PAGE_SIZE_MAX,
)
from .models import Feature, Layer
from .services import feature_counts_for_layer
from .shapefile_properties import extract_road_display_name, table_property_entries


def feature_geometry_json(feature: Feature, *, simplify_tolerance: float = 0) -> dict:
    geom = feature.geom
    if simplify_tolerance > 0:
        geom = geom.simplify(tolerance=simplify_tolerance, preserve_topology=True)
    return json.loads(geom.geojson)


def feature_row_dict(feature: Feature) -> dict:
    env = feature.geom.extent
    cx = (env[0] + env[2]) / 2
    cy = (env[1] + env[3]) / 2
    return {
        "id": feature.pk,
        "status": feature.status,
        "road_name": extract_road_display_name(feature.properties),
        "property_entries": table_property_entries(
            feature.properties, max_rows=FEATURE_PROPERTY_ROWS_TABLE
        ),
        "center": [cx, cy],
        "bbox": [[env[0], env[1]], [env[2], env[3]]],
    }


def feature_detail_dict(feature: Feature) -> dict:
    row = feature_row_dict(feature)
    row["geometry"] = feature_geometry_json(feature)
    return row


def layer_features_extent(features_qs: QuerySet) -> list[list[float]] | None:
    result = features_qs.aggregate(ext=Extent("geom"))
    ext = result.get("ext")
    if not ext:
        return None
    xmin, ymin, xmax, ymax = ext
    return [[float(xmin), float(ymin)], [float(xmax), float(ymax)]]


def _simplify_tolerance_for_bbox(bbox: tuple[float, float, float, float]) -> float:
    xmin, ymin, xmax, ymax = bbox
    span = max(abs(xmax - xmin), abs(ymax - ymin))
    if span > 2:
        return 0.002
    if span > 0.5:
        return 0.0005
    if span > 0.05:
        return 0.00005
    return 0


def parse_bbox_param(raw: str | None) -> tuple[float, float, float, float] | None:
    if not raw or not str(raw).strip():
        return None
    parts = [p.strip() for p in str(raw).split(",")]
    if len(parts) != 4:
        return None
    try:
        xmin, ymin, xmax, ymax = (
            float(parts[0]),
            float(parts[1]),
            float(parts[2]),
            float(parts[3]),
        )
    except ValueError:
        return None
    if xmin > xmax:
        xmin, xmax = xmax, xmin
    if ymin > ymax:
        ymin, ymax = ymax, ymin
    return xmin, ymin, xmax, ymax


def parse_table_pagination(
    page_raw,
    page_size_raw,
    *,
    default_page_size: int = TABLE_PAGE_SIZE_DEFAULT,
) -> tuple[int, int]:
    try:
        page = max(1, int(page_raw or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(page_size_raw or default_page_size)
    except (TypeError, ValueError):
        page_size = default_page_size
    page_size = max(1, min(page_size, TABLE_PAGE_SIZE_MAX))
    return page, page_size


def parse_status_filter(raw: str | None, allowed: Iterable[str]) -> str | None:
    if not raw or not str(raw).strip():
        return None
    status = str(raw).strip()
    allowed_set = set(allowed)
    return status if status in allowed_set else None


def parse_list_all_param(raw) -> bool:
    """True when table.json is called with ``list=all`` (full-screen features panel)."""
    return str(raw or "").strip().lower() == "all"


def paginate_queryset(qs: QuerySet, page: int, page_size: int) -> tuple[list, dict]:
    total = qs.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * page_size
    items = list(qs[offset : offset + page_size])
    return items, {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


def table_payload(
    layer: Layer,
    features_qs: QuerySet,
    *,
    page: int = 1,
    page_size: int = TABLE_PAGE_SIZE_DEFAULT,
    status_filter: str | None = None,
    list_all: bool = False,
) -> dict:
    qs = features_qs.order_by("pk")
    if status_filter:
        qs = qs.filter(status=status_filter)

    total_in_upload = int(layer.total_features or features_qs.count())
    filtered_total = qs.count()

    if list_all:
        if filtered_total > TABLE_LIST_ALL_MAX:
            raise ValueError(
                f"Too many features to list at once ({filtered_total}). "
                f"Maximum is {TABLE_LIST_ALL_MAX}."
            )
        page_items = list(qs[:TABLE_LIST_ALL_MAX])
        pagination = {
            "page": 1,
            "page_size": filtered_total,
            "total": filtered_total,
            "total_pages": 1,
            "list_all": True,
        }
    else:
        page_items, pagination = paginate_queryset(qs, page, page_size)

    extent = layer_features_extent(features_qs)

    return {
        "counts": feature_counts_for_layer(layer),
        "features": [feature_row_dict(f) for f in page_items],
        "pagination": pagination,
        "extent": extent,
        "total_features": total_in_upload,
        "optimized": features_qs.count() > LARGE_LAYER_FEATURE_THRESHOLD,
    }


def features_geojson(
    layer_id: int,
    statuses: Iterable[str],
    *,
    bbox: tuple[float, float, float, float] | None = None,
    limit: int | None = None,
) -> dict:
    statuses = list(statuses)
    qs = Feature.objects.filter(layer_id=layer_id, status__in=statuses).order_by("pk")
    total = qs.count()

    if limit is None:
        if total <= LARGE_LAYER_FEATURE_THRESHOLD and bbox is None:
            limit = GEOJSON_SMALL_LAYER_LIMIT
        elif bbox is None:
            return {
                "type": "FeatureCollection",
                "features": [],
                "truncated": True,
                "limit": 0,
                "total_features": total,
                "requires_bbox": True,
                "extent": layer_features_extent(qs),
            }
        else:
            limit = GEOJSON_VIEWPORT_LIMIT

    tolerance = _simplify_tolerance_for_bbox(bbox) if bbox else 0

    if bbox:
        xmin, ymin, xmax, ymax = bbox
        poly = Polygon.from_bbox((xmin, ymin, xmax, ymax))
        poly.srid = 4326
        qs = qs.filter(geom__intersects=poly)

    matched = qs.count()
    features = []
    for f in qs[:limit]:
        features.append(
            {
                "type": "Feature",
                "id": f.pk,
                "geometry": feature_geometry_json(f, simplify_tolerance=tolerance),
                "properties": {
                    "upload_feature_id": f.pk,
                    "status": f.status,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
        "truncated": matched > len(features),
        "limit": limit,
        "total_features": total,
        "matched_in_view": matched,
        "requires_bbox": False,
    }
