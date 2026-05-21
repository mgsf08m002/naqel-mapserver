"""Approval queue categories for pending road edit requests."""

from __future__ import annotations

from .riyadh_fclass import feature_label_from_riyadh_fclass

EDIT_TYPE_DELETE = "DELETE"
EDIT_TYPE_LAYER_UPLOAD = "Layer Upload"
UPLOAD_SHAPEFILE_FIELD_KEY = "layer_name"

CATEGORY_PRIORITY = (
    "layer_upload",
    "delete_road",
    "new_road",
    "new_road_geometry",
    "change_road_label",
    "add_road_label",
    "new_feature_type",
    "road_attribute_edit",
)

CATEGORY_LABELS = {
    "layer_upload": "Layer Upload",
    "delete_road": "Delete Road",
    "new_road": "New Road",
    "add_road_label": "Add Road Label",
    "change_road_label": "Change Road Label",
    "new_road_geometry": "New Road Geometry",
    "new_feature_type": "New Feature Type",
    "road_attribute_edit": "Road Attribute Edit",
}


def _norm(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _detect_feature_type_change(req, road, fields_data: dict) -> bool:
    proposed_label = _norm(req.current_feature_label)
    original_label = _norm(fields_data.get("_original_feature_label"))
    if not original_label and road is not None:
        original_label = _norm(feature_label_from_riyadh_fclass(getattr(road, "fclass", None)))
    if original_label != proposed_label:
        return True
    if road is not None and fields_data.get("fclass") is not None:
        return _norm(fields_data.get("fclass")) != _norm(getattr(road, "fclass", ""))
    return False


def _detect_label_flags(req, road, fields_data: dict) -> tuple[bool, bool]:
    """Return (add_label, change_label) from road name before vs after."""
    proposed_name = _norm(fields_data.get("name"))
    original_name = _norm(fields_data.get("_original_road_name"))
    if not original_name and road is not None:
        original_name = _norm(getattr(road, "name", ""))
    if proposed_name and not original_name:
        return True, False
    if original_name and proposed_name and original_name != proposed_name:
        return False, True
    return False, False


_RIYADH_REMOTE_FIELD_KEYS = frozenset(
    {
        "ref",
        "oneway",
        "maxspeed",
        "osm_id",
        "code",
        "bridge",
        "tunnel",
        "layer",
    }
)
_RIYADH_FIELDS_UI_ONLY = frozenset({"common_name", "multilingual_names"})
_RIYADH_FIELDS_NON_REVIEWABLE = frozenset(
    {
        "gid",
        "id",
        "objectid",
        "name",
        "fclass",
        "road_closure",
        "shape_length",
        UPLOAD_SHAPEFILE_FIELD_KEY,
        "layer_id",
    }
)


def _num_eq(a, b) -> bool:
    import math
    from decimal import Decimal

    try:
        if a is None or a == "":
            fa = None
        else:
            fa = float(a)
        if b is None:
            fb = None
        elif isinstance(b, Decimal):
            fb = float(b)
        else:
            fb = float(b)
    except (TypeError, ValueError):
        return _norm(a) == _norm(b)
    if fa is None and fb is None:
        return True
    if fa is None or fb is None:
        return False
    return math.isclose(fa, fb, rel_tol=0, abs_tol=1e-5)


def _extra_fields_require_review(fields_data: dict) -> bool:
    for key, value in (fields_data or {}).items():
        if key.startswith("_") or key in _RIYADH_FIELDS_NON_REVIEWABLE or key in _RIYADH_FIELDS_UI_ONLY:
            continue
        if value not in (None, "", [], {}):
            return True
    return False


def _tags_match_client(tags_data, fields_data: dict) -> bool:
    """Match sidebar tag list to mirrored field keys (same rules as manager review)."""
    skip = frozenset({"name", "road_closure", "common_name", "multilingual_names"})
    canon_pairs = []
    for key, value in (fields_data or {}).items():
        if key in skip or key.startswith("_"):
            continue
        if value in (None, "", [], {}):
            continue
        canon_pairs.append((key, str(value)))
    canon_pairs.sort()
    client_pairs = sorted(
        (t.get("key"), str(t.get("value", "")))
        for t in (tags_data or [])
        if t.get("key") not in skip
    )
    return tuple(canon_pairs) == tuple(client_pairs)


def _remote_attributes_differ(fields_data: dict, road) -> bool:
    fd = fields_data or {}
    if _norm(fd.get("ref")) != _norm(getattr(road, "ref", "")):
        return True
    if _norm(fd.get("oneway")) != _norm(getattr(road, "oneway", "")):
        return True
    if not _num_eq(fd.get("maxspeed"), getattr(road, "maxspeed", None)):
        return True
    if _norm(fd.get("osm_id")) != _norm(getattr(road, "osm_id", "")):
        return True
    if not _num_eq(fd.get("code"), getattr(road, "code", None)):
        return True
    if _norm(fd.get("bridge")) != _norm(getattr(road, "bridge", "")):
        return True
    if _norm(fd.get("tunnel")) != _norm(getattr(road, "tunnel", "")):
        return True
    if not _num_eq(fd.get("layer"), getattr(road, "layer", None)):
        return True
    return False


def _detect_geometry_change(req) -> bool:
    if bool(req.geometry_changed):
        return True
    original = req.original_geometry
    geometry = req.geometry
    if original and geometry:
        from .views import _geometries_equivalent_wgs84

        return not _geometries_equivalent_wgs84(original, geometry)
    return False


def _detect_attribute_change(req, road, fields_data: dict) -> bool:
    """Tags, relations, or Add field values — not geometry, feature type, or road label."""
    if req.relations_data:
        return True
    if _extra_fields_require_review(fields_data):
        return True
    tags = req.tags_data or []
    if tags and not _tags_match_client(tags, fields_data):
        return True
    if road is None:
        return False
    return _remote_attributes_differ(fields_data, road)


def is_layer_upload_request(req) -> bool:
    if (getattr(req, "request_category", None) or "").strip() == "layer_upload":
        return True
    if getattr(req, "layer_upload_feature_id", None):
        return True
    return (req.edit_type or "").strip().lower() == EDIT_TYPE_LAYER_UPLOAD.lower()


def is_delete_road_request(req) -> bool:
    if (getattr(req, "request_category", None) or "").strip() == "delete_road":
        return True
    return (req.edit_type or "").upper() == EDIT_TYPE_DELETE


def category_label_for_key(key: str) -> str:
    return CATEGORY_LABELS.get(key, CATEGORY_LABELS["road_attribute_edit"])


def resolve_request_category_key(req, road=None) -> str:
    """Always classify from current row data (fixes stale stored categories in the UI)."""
    return classify_approval_request(req, road=road)["key"]


def create_pending_road_edit_request(*, road=None, **kwargs):
    """Create a pending request with ``request_category`` stored on the row."""
    from .models import LineEditRequest

    instance = LineEditRequest(**kwargs)
    instance.request_category = classify_approval_request(instance, road=road)["key"]
    instance.save()
    return instance


def classify_approval_request(req, road=None) -> dict:
    """
    Return {key, label} for the primary approval category.

    ``road`` may be a pre-fetched RiyadhRoad when listing many pending rows.
    """
    if is_layer_upload_request(req):
        return {"key": "layer_upload", "label": CATEGORY_LABELS["layer_upload"]}

    if is_delete_road_request(req):
        return {"key": "delete_road", "label": CATEGORY_LABELS["delete_road"]}

    if not req.is_riyadh_road or req.riyadh_road_id is None:
        return {"key": "new_road", "label": CATEGORY_LABELS["new_road"]}

    fields_data = req.fields_data if isinstance(req.fields_data, dict) else {}

    add_label, change_label = _detect_label_flags(req, road, fields_data)
    feat_changed = _detect_feature_type_change(req, road, fields_data)
    geom_changed = _detect_geometry_change(req)
    attr_changed = _detect_attribute_change(req, road, fields_data)

    flags: set[str] = set()
    if change_label:
        flags.add("change_road_label")
    if add_label:
        flags.add("add_road_label")
    if feat_changed:
        flags.add("new_feature_type")
    if geom_changed:
        flags.add("new_road_geometry")
    if attr_changed:
        flags.add("road_attribute_edit")

    if not flags:
        flags.add("road_attribute_edit")

    for key in CATEGORY_PRIORITY:
        if key in flags:
            return {"key": key, "label": CATEGORY_LABELS[key]}

    return {"key": "road_attribute_edit", "label": CATEGORY_LABELS["road_attribute_edit"]}
