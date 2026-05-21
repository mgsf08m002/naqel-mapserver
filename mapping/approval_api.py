"""Serialize pending road edit requests for the manager approval queue API."""

from __future__ import annotations

from .approval_categories import (
    UPLOAD_SHAPEFILE_FIELD_KEY,
    category_label_for_key,
    resolve_request_category_key,
)


def _shapefile_name_from_request(req) -> str | None:
    if resolve_request_category_key(req) != "layer_upload":
        return None
    fields = req.fields_data if isinstance(req.fields_data, dict) else {}
    name = fields.get(UPLOAD_SHAPEFILE_FIELD_KEY)
    return str(name) if name else None


def serialize_approval_request_list_item(
    req,
    *,
    road=None,
    profile_image_url=None,
    geometry_wgs84,
    original_geometry_wgs84=None,
) -> dict:
    category_key = resolve_request_category_key(req, road=road)
    item = {
        "id": req.id,
        "requester_name": req.requester.get_full_name() or req.requester.username,
        "requester_role": req.get_requester_role(),
        "profile_image_url": profile_image_url,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "current_feature_label": req.current_feature_label or "Unnamed Road",
        "created_at": req.created_at.isoformat(),
        "geometry": geometry_wgs84,
        "original_geometry": original_geometry_wgs84,
        "geometry_changed": req.geometry_changed,
        "road_closure": req.road_closure,
        "is_riyadh_road": req.is_riyadh_road,
    }
    shapefile = _shapefile_name_from_request(req)
    if shapefile:
        item["shapefile_name"] = shapefile
    return item


def serialize_approval_request_detail(
    req,
    *,
    road=None,
    profile_image_url=None,
    geometry_wgs84,
    original_geometry_wgs84=None,
) -> dict:
    category_key = resolve_request_category_key(req, road=road)
    fields_data = req.fields_data if isinstance(req.fields_data, dict) else {}
    payload = {
        "id": req.id,
        "requester_name": req.requester.get_full_name() or req.requester.username,
        "requester_role": req.get_requester_role(),
        "profile_image_url": profile_image_url,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "current_feature_label": req.current_feature_label or "Unnamed Road",
        "geometry": geometry_wgs84,
        "original_geometry": original_geometry_wgs84,
        "geometry_changed": req.geometry_changed,
        "fields_data": fields_data,
        "tags_data": req.tags_data or [],
        "relations_data": req.relations_data or [],
        "created_at": req.created_at.isoformat(),
        "road_closure": req.road_closure,
        "is_riyadh_road": req.is_riyadh_road,
        "riyadh_road_id": req.riyadh_road_id,
        "layer_upload_feature_id": req.layer_upload_feature_id,
    }
    shapefile = _shapefile_name_from_request(req)
    if shapefile:
        payload["shapefile_name"] = shapefile
    return payload
