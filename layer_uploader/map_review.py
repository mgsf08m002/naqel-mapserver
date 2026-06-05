"""Layer upload items in the manager map approval queue."""

from __future__ import annotations

import json
from typing import Any

from django.contrib.auth.models import AbstractBaseUser
from django.utils import timezone

from mapping.approval_categories import (
    EDIT_TYPE_LAYER_UPLOAD,
    UPLOAD_SHAPEFILE_FIELD_KEY,
    create_pending_road_edit_request,
)
from mapping.models import LineEditRequest

from .models import Feature, Layer
from .services import (
    publish_geometry_to_riyadh_roads,
    refresh_layer_completion,
    reject_feature_by_manager,
)


def _geometry_json_from_feature(feature: Feature) -> dict:
    geom = feature.geom
    if geom.srid and geom.srid != 4326:
        geom = geom.clone()
        geom.transform(4326)
    elif not geom.srid:
        geom.srid = 4326
    return json.loads(geom.geojson)


def _layer_upload_edit_request_kwargs(
    layer: Layer,
    *,
    feature_id: int,
    properties: dict[str, Any] | None,
    geometry_json: dict,
) -> dict[str, Any]:
    from mapping.riyadh_fclass import feature_label_from_riyadh_fclass

    from .services import prepare_road_fields_for_publish

    fields = prepare_road_fields_for_publish(properties=properties)
    display_label = feature_label_from_riyadh_fclass(fields.get("fclass") or None)
    return {
        "requester": layer.uploaded_by,
        "edit_type": EDIT_TYPE_LAYER_UPLOAD,
        "request_category": "layer_upload",
        "geometry": geometry_json,
        "geometry_changed": False,
        "current_feature_label": display_label,
        "fields_data": {
            **fields,
            UPLOAD_SHAPEFILE_FIELD_KEY: layer.name,
            "layer_id": layer.pk,
        },
        "tags_data": [],
        "relations_data": [],
        "road_closure": 0,
        "layer_upload_feature_id": feature_id,
    }


def layer_upload_feature_snapshot(feature: Feature) -> dict[str, Any]:
    """Capture feature data before publish deletes the staging row."""
    return {
        "feature_id": feature.pk,
        "properties": dict(feature.properties or {}),
        "geometry_json": _geometry_json_from_feature(feature),
    }


def create_approval_requests_for_layer_upload(layer: Layer, features) -> None:
    """Create one approval-queue row per nominated upload feature."""
    for feature in features:
        create_pending_road_edit_request(
            road=None,
            **_layer_upload_edit_request_kwargs(
                layer,
                feature_id=feature.pk,
                properties=feature.properties,
                geometry_json=_geometry_json_from_feature(feature),
            ),
        )


def create_approved_layer_upload_edit_request(
    *,
    layer: Layer,
    snapshot: dict[str, Any],
    remote_road_id: float,
    reviewer: AbstractBaseUser,
) -> LineEditRequest:
    """Record an auto-published layer upload in My Edits."""
    edit_request = LineEditRequest(
        **_layer_upload_edit_request_kwargs(
            layer,
            feature_id=int(snapshot["feature_id"]),
            properties=snapshot.get("properties"),
            geometry_json=snapshot["geometry_json"],
        )
    )
    edit_request.status = "approved"
    edit_request.reviewed_at = timezone.now()
    edit_request.reviewed_by = reviewer
    try:
        edit_request.published_road_id = int(float(remote_road_id))
    except (TypeError, ValueError):
        edit_request.published_road_id = None
    edit_request.save()
    return edit_request


def approve_layer_upload_edit_request(edit_request: LineEditRequest) -> tuple[float, str]:
    """
    Publish using the geometry/fields the manager reviewed on the map.
    Returns (remote road id, fclass stored in riyadh_roads).
    """
    feature_id = edit_request.layer_upload_feature_id
    if not feature_id:
        raise ValueError("Layer upload request is missing a feature reference.")

    feature = Feature.objects.filter(pk=feature_id).first()
    if not feature:
        raise LookupError("Upload feature is no longer available for approval.")

    geometry_json = edit_request.geometry
    if not geometry_json:
        geometry_json = _geometry_json_from_feature(feature)

    remote_id = publish_geometry_to_riyadh_roads(
        geometry_json,
        fields_data=edit_request.fields_data if isinstance(edit_request.fields_data, dict) else None,
        properties=feature.properties,
        current_feature_label=edit_request.current_feature_label,
        road_closure=int(edit_request.road_closure or 0),
    )

    fields_data = edit_request.fields_data if isinstance(edit_request.fields_data, dict) else {}
    fclass = (fields_data.get("fclass") or "unclassified").strip().lower() or "unclassified"

    layer = feature.layer
    feature.delete()
    refresh_layer_completion(layer)
    return remote_id, fclass


def reject_layer_upload_edit_request(edit_request: LineEditRequest) -> None:
    feature_id = edit_request.layer_upload_feature_id
    if not feature_id:
        return

    feature = Feature.objects.filter(
        pk=feature_id,
        status=Feature.Status.AWAITING_MANAGER,
    ).first()
    if feature:
        reject_feature_by_manager(feature)
