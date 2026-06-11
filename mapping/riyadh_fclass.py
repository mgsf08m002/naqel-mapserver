"""Riyadh ``fclass`` ↔ UI labels; merged into ``/symbology/api/catalog/`` for MVT paint.

Persisted ``fclass`` lives on ``riyadh_roads``; the client may set MapLibre ``db_fclass``
when tiles lag. ``symbology.json`` must cover every OSM label in ``RIYADH_FCLASS_TO_LABEL``
plus ``Line`` and ``Road Closure`` (enforced in ``symbology/feature_catalog.py``).
"""
from __future__ import annotations

import re
from typing import Any, Final

# Stable order for MapLibre `match` (matches typical highway-class ordering).
RIYADH_FCLASS_KEYS: Final[tuple[str, ...]] = (
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "residential",
    "living_street",
    "service",
    "unclassified",
    "track",
    "footway",
    "steps",
    "path",
    "cycleway",
)

RIYADH_FCLASS_TO_LABEL: Final[dict[str, str]] = {
    "motorway": "Motorway",
    "motorway_link": "Motorway Link",
    "trunk": "Trunk Road",
    "trunk_link": "Trunk Link",
    "primary": "Primary Road",
    "primary_link": "Primary Link",
    "secondary": "Secondary Road",
    "secondary_link": "Secondary Link",
    "tertiary": "Tertiary Road",
    "tertiary_link": "Tertiary Link",
    "residential": "Residential Road",
    "living_street": "Living Street",
    "service": "Service Road",
    "unclassified": "Unclassified Road",
    "track": "Track / Land-Access Road",
    "footway": "Footway",
    "steps": "Steps",
    "path": "Path",
    "cycleway": "Cycleway",
}

def _build_label_to_fclass() -> dict[str, str]:
    inv: dict[str, str] = {}
    for fc, lab in RIYADH_FCLASS_TO_LABEL.items():
        inv[lab.strip().lower()] = fc
    # Aliases users / imports might use
    inv["track / land-access road"] = "track"
    inv["track"] = "track"
    return inv


_LABEL_TO_FCLASS: Final[dict[str, str]] = _build_label_to_fclass()


def feature_label_from_riyadh_fclass(fclass: str | None) -> str:
    """Human‑readable label for sidebar + client; matches symbology keys."""
    raw = (fclass or "").strip().lower()
    if not raw:
        return "Line"
    label = RIYADH_FCLASS_TO_LABEL.get(raw)
    if label:
        return label
    return raw.replace("_", " ").title()


def riyadh_fclass_from_feature_label(label: str | None) -> str | None:
    """Resolve chosen UI label back to OSM‑style fclass for DB / tiles."""
    if not label:
        return None
    normalized = (label or "").strip().lower()
    return _LABEL_TO_FCLASS.get(normalized)


def ensure_riyadh_fclass_in_fields(
    fields: dict[str, Any] | None,
    *,
    current_feature_label: str | None,
    feature_type: str | None,
) -> None:
    """When ``fclass`` is missing, set it from the chosen feature label (DB ↔ MVT symbology)."""
    if not fields or fields.get("fclass"):
        return
    effective_label = (current_feature_label or feature_type or "").strip()
    derived = riyadh_fclass_for_persistence(effective_label)
    if derived:
        fields["fclass"] = derived


def apply_riyadh_fclass_from_feature_label(
    fields: dict[str, Any] | None,
    *,
    current_feature_label: str | None,
    feature_type: str | None,
) -> dict[str, Any]:
    """
    Canonical ``fclass`` for DB / MVT writes.

    The sidebar Feature Type is authoritative; stale copies in tags or fields_data
    must not override the chosen label when persisting to riyadh_roads.
    """
    out = dict(fields or {})
    effective_label = (current_feature_label or feature_type or "").strip()
    derived = riyadh_fclass_for_persistence(effective_label)
    if derived:
        out["fclass"] = derived
        return out
    ensure_riyadh_fclass_in_fields(
        out,
        current_feature_label=current_feature_label,
        feature_type=feature_type,
    )
    return out


def riyadh_fclass_for_persistence(feature_label: str | None) -> str | None:
    """
    Map a sidebar feature label to the value stored in ``riyadh_roads.fclass``:
    OSM classes plus symbology-only slugs (e.g. Retaining Wall → ``retaining_wall``).
    Must match ``merged_riyadh_fclass_payload_for_catalog`` / client ``riyadh_label_to_fclass``.
    """
    if not feature_label or not str(feature_label).strip():
        return None
    osm = riyadh_fclass_from_feature_label(feature_label)
    if osm is not None:
        return osm
    lab = str(feature_label).strip()
    if lab in ("Line", "Road Closure"):
        return None
    slug = _symbology_only_fclass_slug(lab)
    return slug or None


def riyadh_fclass_map_payload() -> dict[str, object]:
    """Merged into `/symbology/api/catalog/` for the map client."""
    return {
        "riyadh_fclass_to_label": dict(RIYADH_FCLASS_TO_LABEL),
        "riyadh_fclass_keys": list(RIYADH_FCLASS_KEYS),
        "riyadh_label_to_fclass": dict(_LABEL_TO_FCLASS),
    }


def _symbology_only_fclass_slug(style_label: str) -> str:
    """Stable ``fclass`` token for non-OSM feature types (e.g. ``Pipeline`` → ``pipeline``)."""
    s = (style_label or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "feature"


def merged_riyadh_fclass_payload_for_catalog(styles_by_label: dict[str, Any]) -> dict[str, object]:
    """Extend ``riyadh_fclass_map_payload()`` with slugs for non-OSM ``styles_by_label`` keys (e.g. Pipeline)."""
    base = riyadh_fclass_map_payload()
    fclass_to_label: dict[str, str] = dict(base["riyadh_fclass_to_label"])
    label_to_fclass: dict[str, str] = dict(base["riyadh_label_to_fclass"])
    known_fclass = set(fclass_to_label.keys())
    ordered_osm = set(RIYADH_FCLASS_KEYS)

    for style_label in styles_by_label.keys():
        if not style_label or style_label in ("Line", "Road Closure"):
            continue
        if riyadh_fclass_from_feature_label(style_label) is not None:
            continue
        base_slug = _symbology_only_fclass_slug(style_label)
        slug = base_slug
        suffix = 0
        while slug in known_fclass and fclass_to_label.get(slug) != style_label:
            suffix += 1
            slug = f"{base_slug}_{suffix}"
        fclass_to_label[slug] = style_label
        known_fclass.add(slug)
        label_to_fclass[style_label.strip().lower()] = slug

    extra_keys = sorted(k for k in fclass_to_label.keys() if k not in ordered_osm)
    merged_keys = list(RIYADH_FCLASS_KEYS) + extra_keys

    return {
        "riyadh_fclass_to_label": fclass_to_label,
        "riyadh_fclass_keys": merged_keys,
        "riyadh_label_to_fclass": label_to_fclass,
    }
