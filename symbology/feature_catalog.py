from __future__ import annotations

from typing import Dict, TypedDict, Any
from pathlib import Path
import json


class LineStyle(TypedDict, total=False):
    """
    Symbology style definition for a linear feature type.

    This is intentionally minimal and frontend-agnostic: it maps cleanly to
    MapLibre `line-*` paint properties and the existing vertex-marker styling
    used in the editing module. The optional `lineDasharray` is used for
    dashed lines (e.g. Road Closure); when absent, lines render solid.
    """

    lineColor: str
    glowColor: str
    lineWidth: float
    glowWidth: float
    glowOpacity: float
    markerColor: str
    markerGlowColor: str
    lineDasharray: list


class SymbologyCatalog(TypedDict):
    """
    Top-level catalog structure returned to the frontend.

    The `styles_by_label` keys are human-readable feature labels such as
    "Motorway" or "Minor/Unclassified Road". The frontend normalizes lookups
    to be case-insensitive, so producers may use any consistent capitalization.
   """

    version: int
    styles_by_label: Dict[str, LineStyle]


def get_catalog() -> SymbologyCatalog:
    """
    Build the current symbology catalog structure.

    This implementation loads the catalog from the JSON file located at
    symbology/symbology.json so that non-technical users can manage all
    symbology from a single, human-readable source.
    """
    module_dir = Path(__file__).resolve().parent
    json_path = module_dir / "symbology.json"

    if not json_path.exists():
        raise FileNotFoundError(f"Symbology catalog JSON not found at {json_path}")

    with json_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, dict):
        raise ValueError("Symbology catalog JSON must be an object.")

    if "version" not in raw:
        raise ValueError("Symbology catalog JSON missing required key: 'version'.")
    version = int(raw["version"])

    if "styles_by_label" not in raw:
        raise ValueError(
            "Symbology catalog JSON missing required key: 'styles_by_label'."
        )
    styles_raw: Any = raw["styles_by_label"]
    if not isinstance(styles_raw, dict):
        raise ValueError("'styles_by_label' must be an object mapping labels to styles.")

    styles: Dict[str, LineStyle] = {}
    for label, style in styles_raw.items():
        if not label:
            continue

        if not isinstance(style, dict):
            raise ValueError(f"Style for '{label}' must be an object.")

        required_keys = (
            "lineColor",
            "glowColor",
            "lineWidth",
            "glowWidth",
            "glowOpacity",
            "markerColor",
            "markerGlowColor",
        )
        missing = [k for k in required_keys if k not in style]
        if missing:
            raise ValueError(
                f"Style for '{label}' missing required keys: {', '.join(missing)}"
            )

        line_color = str(style["lineColor"])
        glow_color = str(style["glowColor"])
        line_width = float(style["lineWidth"])
        glow_width = float(style["glowWidth"])
        glow_opacity = float(style["glowOpacity"])
        marker_color = str(style["markerColor"])
        marker_glow_color = str(style["markerGlowColor"])

        result: LineStyle = {
            "lineColor": line_color,
            "glowColor": glow_color,
            "lineWidth": line_width,
            "glowWidth": glow_width,
            "glowOpacity": glow_opacity,
            "markerColor": marker_color,
            "markerGlowColor": marker_glow_color,
        }
        if "lineDasharray" in style and isinstance(style["lineDasharray"], list):
            result["lineDasharray"] = [float(x) for x in style["lineDasharray"]]
        styles[label] = result

    return {
        "version": version,
        "styles_by_label": styles,
    }

