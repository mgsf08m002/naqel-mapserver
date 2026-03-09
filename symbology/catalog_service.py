from __future__ import annotations

from typing import Dict

from django.db.models import QuerySet

from .feature_catalog import (
    LineStyle,
    SymbologyCatalog,
    STYLES_BY_LABEL,
    SYMBOL_LINE_WIDTH,
    SYMBOL_VERSION,
)
from .models import SymbologyStyle


def _styles_from_queryset(qs: QuerySet[SymbologyStyle]) -> Dict[str, LineStyle]:
    """
    Build the styles_by_label mapping from the SymbologyStyle queryset.

    This keeps the JSON shape identical to the legacy catalog returned by
    feature_catalog.get_catalog(), so existing frontend code continues to work
    without modification.
    """
    styles: Dict[str, LineStyle] = {}
    for style in qs:
        styles[style.label] = {
            "lineColor": style.line_color,
            "glowColor": style.glow_color,
            # Apply the global SYMBOL_LINE_WIDTH for consistency across all styles.
            "lineWidth": SYMBOL_LINE_WIDTH,
            "glowWidth": float(style.glow_width),
            "glowOpacity": float(style.glow_opacity),
            "markerColor": style.marker_color,
            "markerGlowColor": style.marker_glow_color,
        }
    return styles


def get_catalog() -> SymbologyCatalog:
    """
    Build the current symbology catalog structure.

    Preferred source of truth is the SymbologyStyle model so that styles are
    fully data-driven and editable via the admin/UI. The legacy STYLES_BY_LABEL
    dictionary is retained as a bootstrap/default configuration that can be
    loaded into the database once and then maintained there.
    """
    qs: QuerySet[SymbologyStyle] = SymbologyStyle.objects.filter(is_active=True)

    if qs.exists():
        styles = _styles_from_queryset(qs)
    else:
        # Fallback for first-time deployments or when the DB has not been
        # initialized with rows yet: use the in-code defaults.
        styles: Dict[str, LineStyle] = {}
        for label, style in STYLES_BY_LABEL.items():
            styles[label] = {**style, "lineWidth": SYMBOL_LINE_WIDTH}

    return {
        "version": SYMBOL_VERSION,
        "styles_by_label": styles,
    }

