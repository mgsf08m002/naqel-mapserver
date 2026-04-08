from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, TypedDict
import json


class RoadLabelingConfig(TypedDict):
    enabled: bool
    min_zoom_en: float
    min_zoom_ar: float
    max_zoom: float
    text_size: Dict[str, float]
    text_color: str
    halo_color: str
    halo_width: float
    halo_blur: float
    symbol_spacing: float
    max_angle: float
    padding: float
    placement: str
    allow_overlap: bool
    ignore_placement: bool
    english: Dict[str, Any]
    arabic: Dict[str, Any]


def get_road_labeling_config() -> RoadLabelingConfig:
    module_dir = Path(__file__).resolve().parent
    json_path = module_dir / "labeling.json"
    if not json_path.exists():
        raise FileNotFoundError(f"Labeling config JSON not found at {json_path}")

    with json_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, dict):
        raise ValueError("Labeling config JSON must be an object.")

    defaults: Dict[str, Any] = {
        "enabled": True,
        "min_zoom_en": 11.0,
        "min_zoom_ar": 11.8,
        "max_zoom": 22.0,
        "text_size": {
            "base": 11.0,
            "mid": 13.0,
            "high": 15.0,
        },
        "text_color": "#0f172a",
        "halo_color": "#ffffff",
        "halo_width": 1.8,
        "halo_blur": 0.4,
        "placement": "line-center",
        "allow_overlap": True,
        "ignore_placement": True,
        "symbol_spacing": 480.0,
        "max_angle": 35.0,
        "padding": 3.0,
        "english": {
            "field": "name_en",
            "font_stack": ["Open Sans Regular", "Noto Sans Regular"],
            "offset_em": [0.0, -0.85],
            "optional": True,
        },
        "arabic": {
            "field": "name_ar",
            "font_stack": ["Noto Sans Arabic Regular", "Open Sans Regular"],
            "offset_em": [0.0, 0.85],
            "optional": True,
        },
    }

    cfg: Dict[str, Any] = {**defaults, **raw}
    if not isinstance(cfg.get("text_size"), dict):
        cfg["text_size"] = dict(defaults["text_size"])
    else:
        cfg["text_size"] = {**defaults["text_size"], **cfg["text_size"]}

    for lang in ("english", "arabic"):
        lang_raw = cfg.get(lang)
        if not isinstance(lang_raw, dict):
            cfg[lang] = dict(defaults[lang])
            continue
        merged = {**defaults[lang], **lang_raw}
        if not isinstance(merged.get("font_stack"), list) or not merged["font_stack"]:
            merged["font_stack"] = list(defaults[lang]["font_stack"])
        if not isinstance(merged.get("offset_em"), list) or len(merged["offset_em"]) != 2:
            merged["offset_em"] = list(defaults[lang]["offset_em"])
        cfg[lang] = merged

    return cfg  # type: ignore[return-value]
