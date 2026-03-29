"""
Canonical mapping between Riyadh road `fclass` (PostGIS / vector tiles) and
symbology / UI feature labels.

**Source of truth (production contract)**

- Persisted classification lives on the remote `riyadh_roads` database (column
  `fclass`). The map editor reads/writes it via Django APIs; saves use the
  same helpers as this module so labels and `fclass` stay consistent in code.

- Vector tiles should be built from that same database (tippecanoe / tileserver).
  MVT `fclass` should match the DB after each successful publish. Until tiles
  catch up (CDN, job lag), MVT can be stale; the web client may set MapLibre
  feature-state `db_fclass` from API payloads so symbology matches the DB
  immediately.

- Symbology is driven by `/symbology/api/catalog/`, which merges
  `riyadh_fclass_map_payload()` so the browser uses the same keys and label
  maps as the server.

`symbology.json` must define `styles_by_label` for every value in
`RIYADH_FCLASS_TO_LABEL` (plus `Line` and `Road Closure`). This is enforced at
catalog load by `symbology/feature_catalog.py`.
"""
from __future__ import annotations

from typing import Final

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


def riyadh_fclass_map_payload() -> dict[str, object]:
    """Merged into `/symbology/api/catalog/` for the map client."""
    return {
        "riyadh_fclass_to_label": dict(RIYADH_FCLASS_TO_LABEL),
        "riyadh_fclass_keys": list(RIYADH_FCLASS_KEYS),
        "riyadh_label_to_fclass": dict(_LABEL_TO_FCLASS),
    }
