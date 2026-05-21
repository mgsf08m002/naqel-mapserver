"""Layer upload items in the manager map Pending Edit Requests queue."""

from __future__ import annotations

import json

from mapping.models import LineEditRequest
from mapping.riyadh_fclass import feature_label_from_riyadh_fclass

from .models import Feature, Layer

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
    """Create one pending edit request per nominated upload feature."""
    from .services import properties_to_road_fields

    for feature in features:
        fields = properties_to_road_fields(feature.properties)
        label = feature_label_from_riyadh_fclass(fields.get("fclass") or None)
        LineEditRequest.objects.create(
            requester=layer.uploaded_by,
            edit_type=LAYER_UPLOAD_EDIT_TYPE,
            geometry=_geometry_json_from_feature(feature),
            geometry_changed=False,
            feature_type=label,
            current_feature_label=label,
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


def approve_layer_upload_edit_request(edit_request: LineEditRequest) -> float:
    from .services import approve_and_publish_feature

    feature_id = edit_request.layer_upload_feature_id
    if not feature_id:
        raise ValueError("Layer upload request is missing a feature reference.")

    feature = Feature.objects.filter(pk=feature_id).first()
    if not feature:
        raise LookupError("Upload feature is no longer available for approval.")

    return approve_and_publish_feature(feature)


def reject_layer_upload_edit_request(edit_request: LineEditRequest) -> None:
    from .services import reject_feature_by_manager

    feature_id = edit_request.layer_upload_feature_id
    if not feature_id:
        return

    feature = Feature.objects.filter(
        pk=feature_id,
        status=Feature.Status.AWAITING_MANAGER,
    ).first()
    if feature:
        reject_feature_by_manager(feature)
