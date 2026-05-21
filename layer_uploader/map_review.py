"""Layer upload items in the manager map approval queue."""

from __future__ import annotations

import json

from mapping.models import LineEditRequest

from .models import Feature, Layer
from .services import (
    publish_geometry_to_riyadh_roads,
    refresh_layer_completion,
    reject_feature_by_manager,
)

LAYER_UPLOAD_EDIT_TYPE = "Layer Upload"


def is_layer_upload_edit_request(edit_request: LineEditRequest) -> bool:
    return (edit_request.edit_type or "").strip().lower() == LAYER_UPLOAD_EDIT_TYPE.lower()


def _geometry_json_from_feature(feature: Feature) -> dict:
    geom = feature.geom
    if geom.srid and geom.srid != 4326:
        geom = geom.clone()
        geom.transform(4326)
    elif not geom.srid:
        geom.srid = 4326
    return json.loads(geom.geojson)


def create_line_edit_requests_for_layer_upload(layer: Layer, features) -> None:
    """Create one approval-queue edit request per nominated upload feature."""
    from mapping.riyadh_fclass import feature_label_from_riyadh_fclass

    from .services import prepare_road_fields_for_publish

    for feature in features:
        fields = prepare_road_fields_for_publish(properties=feature.properties)
        display_label = feature_label_from_riyadh_fclass(fields.get("fclass") or None)
        LineEditRequest.objects.create(
            requester=layer.uploaded_by,
            edit_type=LAYER_UPLOAD_EDIT_TYPE,
            geometry=_geometry_json_from_feature(feature),
            geometry_changed=False,
            feature_type=display_label,
            current_feature_label=display_label,
            fields_data={
                **fields,
                "layer_name": layer.name,
                "layer_id": layer.pk,
            },
            tags_data=[],
            relations_data=[],
            road_closure=0,
            layer_upload_feature_id=feature.pk,
        )


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
