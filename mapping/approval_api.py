"""Serialize pending road edit requests for the manager approval queue API."""

from __future__ import annotations

from .approval_categories import (
    UPLOAD_SHAPEFILE_FIELD_KEY,
    category_label_for_key,
    is_delete_road_request,
    resolve_request_category_key,
)

EDIT_LIST_LIMIT = 200


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


def _road_name_from_request(req) -> str:
    fields = req.fields_data if isinstance(req.fields_data, dict) else {}
    name = (fields.get("name") or "").strip()
    if name:
        return name
    return req.current_feature_label or "Unnamed Road"


def serialize_my_edit_request_item(req, *, road=None) -> dict:
    category_key = resolve_request_category_key(req, road=road)
    reviewer = None
    if req.reviewed_by_id and req.reviewed_by:
        reviewer = {
            "name": req.reviewed_by.get_full_name() or req.reviewed_by.username,
            "username": req.reviewed_by.username,
        }
    can_open = (
        req.status == "approved"
        and not is_delete_road_request(req)
        and req.published_road_id is not None
    )
    item = {
        "id": req.id,
        "status": req.status,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "current_feature_label": req.current_feature_label or "Unnamed Road",
        "road_name": _road_name_from_request(req),
        "created_at": req.created_at.isoformat(),
        "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
        "reviewer": reviewer,
        "can_open_on_map": can_open,
        "map_road_id": req.published_road_id if can_open else None,
    }
    shapefile = _shapefile_name_from_request(req)
    if shapefile:
        item["shapefile_name"] = shapefile
    return item


def serialize_manager_review_history_item(req, *, road=None) -> dict:
    item = serialize_my_edit_request_item(req, road=road)
    requester = req.requester
    item["requester"] = {
        "name": requester.get_full_name() or requester.username,
        "username": requester.username,
        "role": req.get_requester_role(),
    }
    return item


def serialize_edit_request_list(requests, serialize_item) -> list[dict]:
    """Serialize edit rows, attaching Riyadh road context when available."""
    from .models import RiyadhRoad

    riyadh_ids = [
        req.riyadh_road_id
        for req in requests
        if req.is_riyadh_road and req.riyadh_road_id is not None
    ]
    roads_by_id = {}
    if riyadh_ids:
        for road in RiyadhRoad.objects.using("riyadh_roads").filter(gid__in=riyadh_ids):
            roads_by_id[int(road.gid)] = road

    items = []
    for req in requests:
        road = (
            roads_by_id.get(int(req.riyadh_road_id))
            if req.riyadh_road_id is not None
            else None
        )
        items.append(serialize_item(req, road=road))
    return items
