"""Serialize editor road edit requests for the manager approval queue API."""

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
    req, *, road=None, profile_image_url=None
) -> dict:
    """Bell-queue row only - map geometry comes from the detail endpoint."""
    category_key = resolve_request_category_key(req, road=road)
    feature_label = (req.current_feature_label or "").strip()
    item = {
        "id": req.id,
        "requester_name": req.requester.get_full_name() or req.requester.username,
        "requester_email": req.requester.email or "",
        "requester_role": req.get_requester_role(),
        "profile_image_url": profile_image_url,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "road_name": _road_name_from_request(req, road=road),
        "current_feature_label": feature_label,
        "created_at": req.created_at.isoformat(),
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
    feature_label = (req.current_feature_label or "").strip()
    payload = {
        "id": req.id,
        "requester_name": req.requester.get_full_name() or req.requester.username,
        "requester_email": req.requester.email or "",
        "requester_role": req.get_requester_role(),
        "profile_image_url": profile_image_url,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "road_name": _road_name_from_request(req, road=road),
        "current_feature_label": feature_label,
        "geometry": geometry_wgs84,
        "original_geometry": original_geometry_wgs84,
        "geometry_changed": req.geometry_changed,
        "fields_data": fields_data,
        "created_at": req.created_at.isoformat(),
        "road_closure": req.road_closure,
        "is_riyadh_road": req.is_riyadh_road,
        "riyadh_road_id": req.riyadh_road_id,
    }
    shapefile = _shapefile_name_from_request(req)
    if shapefile:
        payload["shapefile_name"] = shapefile
    return payload


def _road_name_from_request(req, road=None) -> str:
    """Return the road's display name only - never the feature-type label."""
    fields = req.fields_data if isinstance(req.fields_data, dict) else {}
    for key in ("name", "_original_road_name"):
        name = (fields.get(key) or "").strip()
        if name:
            return name
    if road is not None:
        road_name = (getattr(road, "name", None) or "").strip()
        if road_name:
            return road_name
    return ""


def serialize_my_edit_request_item(req, *, road=None, language="en") -> dict:
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
    reason = req.rejection_reason_for(language) if req.status == "rejected" else ""
    item = {
        "id": req.id,
        "status": req.status,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "current_feature_label": (req.current_feature_label or "").strip(),
        "road_name": _road_name_from_request(req, road=road),
        "created_at": req.created_at.isoformat(),
        "reviewer": reviewer,
        "rejection_reason": reason,
        "no_reason": req.status == "rejected" and not bool(reason),
        "can_open_on_map": can_open,
        "map_road_id": req.published_road_id if can_open else None,
    }
    shapefile = _shapefile_name_from_request(req)
    if shapefile:
        item["shapefile_name"] = shapefile
    return item


def serialize_editor_outcome_notification_item(req, *, road=None, language="en") -> dict:
    """Unread approve/reject outcome for the editor header bell."""
    category_key = resolve_request_category_key(req, road=road)
    is_delete = is_delete_road_request(req)
    map_road_id = None
    if not is_delete:
        if req.published_road_id is not None:
            map_road_id = req.published_road_id
        elif req.is_riyadh_road and req.riyadh_road_id is not None:
            map_road_id = req.riyadh_road_id

    reason = req.rejection_reason_for(language) if req.status == "rejected" else ""
    return {
        "id": req.id,
        "status": req.status,
        "request_category": category_key,
        "request_category_label": category_label_for_key(category_key),
        "current_feature_label": (req.current_feature_label or "").strip(),
        "road_name": _road_name_from_request(req, road=road),
        "rejection_reason": reason,
        "no_reason": req.status == "rejected" and not bool(reason),
        "can_open_on_map": map_road_id is not None,
        "map_road_id": map_road_id,
    }


def serialize_manager_review_history_item(req, *, road=None, language="en") -> dict:
    item = serialize_my_edit_request_item(req, road=road, language=language)
    # Review history shows submitter + status/reason - not reviewer metadata.
    item.pop("reviewer", None)
    requester = req.requester
    item["requester"] = {
        "name": requester.get_full_name() or requester.username,
        "username": requester.username,
    }
    return item


def serialize_edit_request_list(requests, serialize_item, *, language="en") -> list[dict]:
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
        items.append(serialize_item(req, road=road, language=language))
    return items
