"""Shapefile attribute parsing for layer upload features."""

from __future__ import annotations

import json
import re
from typing import Any

from .constants import FEATURE_PROPERTY_ROWS_TABLE, TABLE_PROPERTY_SKIP_KEYS

_PROPERTY_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("name", "NAME", "Name", "road_name", "ROAD_NAME"),
    "ref": ("ref", "REF", "Ref"),
    "fclass": ("fclass", "FCLASS", "highway", "HIGHWAY", "class", "CLASS"),
    "oneway": ("oneway", "ONEWAY", "ONE_WAY"),
    "maxspeed": ("maxspeed", "MAXSPEED", "max_speed"),
    "osm_id": ("osm_id", "OSM_ID", "osmid"),
    "code": ("code", "CODE"),
    "bridge": ("bridge", "BRIDGE"),
    "tunnel": ("tunnel", "TUNNEL"),
    "layer": ("layer", "LAYER", "z_layer", "Z_LAYER"),
}

_OSM_TAG_PAIR_RE = re.compile(r'"([^"]+)"=>"([^"]*)"')
_ARABIC_SCRIPT_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]")
_LATIN_SCRIPT_RE = re.compile(r"[A-Za-z]")
_SKIP_KEY_LOWER = frozenset(k.lower() for k in TABLE_PROPERTY_SKIP_KEYS)


def _norm_str(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def coerce_feature_properties(properties: Any) -> dict[str, Any]:
    """JSONField values may be stored as a dict or a JSON string — normalize to dict."""
    if properties is None:
        return {}
    if isinstance(properties, dict):
        return properties
    if isinstance(properties, str):
        text = properties.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _parse_osm_other_tags(value) -> dict[str, str]:
    if value in (None, ""):
        return {}
    text = str(value).strip()
    if not text:
        return {}
    return {key: val for key, val in _OSM_TAG_PAIR_RE.findall(text)}


def _pick_property(props: dict[str, Any], field: str):
    if not props:
        return None
    for key in _PROPERTY_ALIASES.get(field, (field,)):
        if key in props and props[key] not in (None, ""):
            return props[key]
        lower_map = {str(k).lower(): v for k, v in props.items()}
        if key.lower() in lower_map and lower_map[key.lower()] not in (None, ""):
            return lower_map[key.lower()]
    return None


def _split_bilingual_label(label_text: str) -> tuple[str, str]:
    raw_label = (label_text or "").strip()
    if not raw_label:
        return "", ""

    has_ar = bool(_ARABIC_SCRIPT_RE.search(raw_label))
    has_latin = bool(_LATIN_SCRIPT_RE.search(raw_label))

    if has_ar and not has_latin:
        return "", raw_label
    if has_latin and not has_ar:
        return raw_label, ""
    return raw_label, ""


def resolve_road_name_fields(properties: Any) -> dict[str, str]:
    """Return display, English, and Arabic road labels from upload properties."""
    props = coerce_feature_properties(properties)
    tags = _parse_osm_other_tags(props.get("other_tags"))
    name_en = _norm_str(tags.get("name:en") or tags.get("name_en"))
    name_ar = _norm_str(tags.get("name:ar") or tags.get("name_ar"))

    for source in (_pick_property(props, "name"), tags.get("name")):
        val = _norm_str(source)
        if not val:
            continue
        en, ar = _split_bilingual_label(val)
        if en and not name_en:
            name_en = en
        if ar and not name_ar:
            name_ar = ar

    if name_en and name_ar and name_en != name_ar:
        display = f"{name_en} / {name_ar}"
    else:
        display = name_en or name_ar or ""

    return {"name": display, "name_en": name_en, "name_ar": name_ar}


def extract_road_display_name(properties: Any) -> str:
    return resolve_road_name_fields(properties)["name"]


def pick_shapefile_property(props: dict[str, Any], field: str):
    """Public accessor for shapefile field aliases used when publishing roads."""
    return _pick_property(props, field)


def table_property_entries(properties: Any, max_rows: int = FEATURE_PROPERTY_ROWS_TABLE) -> list[dict[str, str]]:
    props = coerce_feature_properties(properties)
    if not props:
        return []

    rows: list[dict[str, str]] = []
    for key in sorted(props.keys(), key=lambda k: str(k).lower()):
        if str(key).lower() in _SKIP_KEY_LOWER:
            continue
        if len(rows) >= max_rows:
            break
        val = props[key]
        if val in (None, ""):
            continue
        if isinstance(val, (dict, list)):
            try:
                val_str = json.dumps(val, ensure_ascii=False)
            except TypeError:
                val_str = str(val)
        else:
            val_str = str(val).strip()
        if not val_str:
            continue
        rows.append({"key": str(key), "value": val_str})
    return rows
