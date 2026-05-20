"""JSON/GeoJSON builders for layer upload review APIs."""

from __future__ import annotations

import json
from typing import Iterable

from .models import Feature, Layer
from .services import feature_counts_for_layer


def property_entries(properties, max_rows: int = 24) -> list[dict[str, str]]:
    if not properties or not isinstance(properties, dict):
        return []
    rows = []
    for key in sorted(properties.keys(), key=lambda k: str(k).lower()):
        if len(rows) >= max_rows:
            break
        val = properties[key]
        if isinstance(val, (dict, list)):
            try:
                val_str = json.dumps(val, ensure_ascii=False)
            except TypeError:
                val_str = str(val)
        else:
            val_str = "" if val is None else str(val)
        rows.append({"key": str(key), "value": val_str})
    return rows


def feature_geometry_json(feature: Feature) -> dict:
    return json.loads(feature.geom.geojson)


def feature_row_dict(feature: Feature) -> dict:
    env = feature.geom.extent
    cx = (env[0] + env[2]) / 2
    cy = (env[1] + env[3]) / 2
    return {
        "id": feature.pk,
        "status": feature.status,
        "property_entries": property_entries(feature.properties),
        "center": [cx, cy],
        "bbox": [[env[0], env[1]], [env[2], env[3]]],
        "geometry": feature_geometry_json(feature),
    }


def features_geojson(layer_id: int, statuses: Iterable[str]) -> dict:
    qs = Feature.objects.filter(layer_id=layer_id, status__in=statuses).order_by("pk")
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": f.pk,
                "geometry": feature_geometry_json(f),
                "properties": {
                    "upload_feature_id": f.pk,
                    "status": f.status,
                },
            }
            for f in qs
        ],
    }


def table_payload(layer: Layer, *, review_mode: str, features_qs) -> dict:
    payload = {
        "layer": {
            "id": layer.pk,
            "name": layer.name,
            "status": layer.status,
        },
        "counts": feature_counts_for_layer(layer),
        "features": [feature_row_dict(f) for f in features_qs],
        "review_mode": review_mode,
    }
    if review_mode == "manager":
        payload["layer"]["uploaded_by"] = (
            layer.uploaded_by.get_full_name() or layer.uploaded_by.username
        )
    return payload
