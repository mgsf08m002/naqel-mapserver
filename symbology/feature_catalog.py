from __future__ import annotations

from typing import Dict, TypedDict


class LineStyle(TypedDict, total=False):
    """
    Symbology style definition for a linear feature type.

    This is intentionally minimal and frontend-agnostic: it maps cleanly to
    MapLibre `line-*` paint properties and the existing vertex-marker styling
    used in the editing module.
    """

    lineColor: str
    glowColor: str
    lineWidth: float
    glowWidth: float
    glowOpacity: float
    markerColor: str
    markerGlowColor: str


class SymbologyCatalog(TypedDict):
    """
    Top-level catalog structure returned to the frontend.

    The `styles_by_label` keys are human-readable feature labels such as
    "Motorway" or "Minor/Unclassified Road". The frontend normalizes lookups
    to be case-insensitive, so producers may use any consistent capitalization.
   """

    version: int
    styles_by_label: Dict[str, LineStyle]


SYMBOL_VERSION: int = 1

# Default stroke width for all feature types on the map (single place to change).
SYMBOL_LINE_WIDTH: float = 3.0

# NOTE:
# - Every feature type gets a distinct base color to preserve visual
#   differentiation, even across groups (roads, rails, paths, waterways, etc.).
# - lineWidth in STYLES_BY_LABEL is overridden to SYMBOL_LINE_WIDTH in get_catalog().
# - Road closure uses dotted red line and is applied in the frontend, not here.
# - Colors are chosen from a high-contrast palette inspired by Tailwind.
# - Every feature type has a distinct lineColor/glowColor so symbology differs.

STYLES_BY_LABEL: Dict[str, LineStyle] = {
    "Line": {
        "lineColor": "#94a3b8",
        "glowColor": "#cbd5e1",
        "lineWidth": 3,
        "glowWidth": 8,
        "glowOpacity": 0.5,
        "markerColor": "#f8fafc",
        "markerGlowColor": "#94a3b8",
    },
    # Major roads
    "Motorway": {
        "lineColor": "#2563eb",
        "glowColor": "#2563eb",
        "lineWidth": 6,
        "glowWidth": 12,
        "glowOpacity": 0.65,
        "markerColor": "#ffffff",
        "markerGlowColor": "#2563eb",
    },
    "Trunk Road": {
        "lineColor": "#059669",
        "glowColor": "#059669",
        "lineWidth": 6,
        "glowWidth": 12,
        "glowOpacity": 0.65,
        "markerColor": "#ffffff",
        "markerGlowColor": "#059669",
    },
    "Primary Road": {
        "lineColor": "#ea580c",
        "glowColor": "#ea580c",
        "lineWidth": 5,
        "glowWidth": 10,
        "glowOpacity": 0.55,
        "markerColor": "#ffffff",
        "markerGlowColor": "#ea580c",
    },
    "Secondary Road": {
        "lineColor": "#eab308",
        "glowColor": "#eab308",
        "lineWidth": 5,
        "glowWidth": 10,
        "glowOpacity": 0.55,
        "markerColor": "#ffffff",
        "markerGlowColor": "#eab308",
    },
    "Tertiary Road": {
        "lineColor": "#a855f7",
        "glowColor": "#a855f7",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.5,
        "markerColor": "#ffffff",
        "markerGlowColor": "#a855f7",
    },
    "Motorway Link": {
        "lineColor": "#38bdf8",
        "glowColor": "#38bdf8",
        "lineWidth": 5,
        "glowWidth": 10,
        "glowOpacity": 0.55,
        "markerColor": "#ffffff",
        "markerGlowColor": "#38bdf8",
    },
    "Trunk Link": {
        "lineColor": "#22c55e",
        "glowColor": "#22c55e",
        "lineWidth": 5,
        "glowWidth": 10,
        "glowOpacity": 0.55,
        "markerColor": "#ffffff",
        "markerGlowColor": "#22c55e",
    },
    "Primary Link": {
        "lineColor": "#fb923c",
        "glowColor": "#fb923c",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.5,
        "markerColor": "#ffffff",
        "markerGlowColor": "#fb923c",
    },
    "Secondary Link": {
        "lineColor": "#facc15",
        "glowColor": "#facc15",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.5,
        "markerColor": "#ffffff",
        "markerGlowColor": "#facc15",
    },
    "Tertiary Link": {
        "lineColor": "#c4b5fd",
        "glowColor": "#c4b5fd",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.5,
        "markerColor": "#ffffff",
        "markerGlowColor": "#c4b5fd",
    },
    # Minor roads
    "Minor/Unclassified Road": {
        "lineColor": "#06b6d4",
        "glowColor": "#06b6d4",
        "lineWidth": 4,
        "glowWidth": 8,
        "glowOpacity": 0.55,
        "markerColor": "#ffffff",
        "markerGlowColor": "#06b6d4",
    },
    "Residential Road": {
        "lineColor": "#ec4899",
        "glowColor": "#ec4899",
        "lineWidth": 4,
        "glowWidth": 8,
        "glowOpacity": 0.6,
        "markerColor": "#ffffff",
        "markerGlowColor": "#ec4899",
    },
    "Living Street": {
        "lineColor": "#84cc16",
        "glowColor": "#84cc16",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.5,
        "markerColor": "#ffffff",
        "markerGlowColor": "#84cc16",
    },
    "Service Road": {
        "lineColor": "#f97316",
        "glowColor": "#f97316",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.55,
        "markerColor": "#ffffff",
        "markerGlowColor": "#f97316",
    },
    "Track / Land-Access Road": {
        "lineColor": "#f43f5e",
        "glowColor": "#f43f5e",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.6,
        "markerColor": "#ffffff",
        "markerGlowColor": "#f43f5e",
    },
    # Rails
    "Train Track": {
        "lineColor": "#4b5563",
        "glowColor": "#9ca3af",
        "lineWidth": 3.5,
        "glowWidth": 7,
        "glowOpacity": 0.5,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#9ca3af",
    },
    "Disused Railway": {
        "lineColor": "#78716c",
        "glowColor": "#78716c",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.4,
        "markerColor": "#f9fafb",
        "markerGlowColor": "#78716c",
    },
    "Tram Track": {
        "lineColor": "#15803d",
        "glowColor": "#15803d",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.5,
        "markerColor": "#dcfce7",
        "markerGlowColor": "#15803d",
    },
    "Underground Railway Track": {
        "lineColor": "#0f172a",
        "glowColor": "#0f172a",
        "lineWidth": 3,
        "glowWidth": 8,
        "glowOpacity": 0.6,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#0f172a",
    },
    "Narrow Guage Track": {
        "lineColor": "#8b5cf6",
        "glowColor": "#8b5cf6",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.5,
        "markerColor": "#f5f3ff",
        "markerGlowColor": "#8b5cf6",
    },
    "Light Rail Track": {
        "lineColor": "#14b8a6",
        "glowColor": "#14b8a6",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.5,
        "markerColor": "#ecfeff",
        "markerGlowColor": "#14b8a6",
    },
    "Monorail Track": {
        "lineColor": "#7c3aed",
        "glowColor": "#7c3aed",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.5,
        "markerColor": "#faf5ff",
        "markerGlowColor": "#7c3aed",
    },
    "Funicular Track": {
        "lineColor": "#fb7185",
        "glowColor": "#fb7185",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.5,
        "markerColor": "#fff1f2",
        "markerGlowColor": "#fb7185",
    },
    # Paths
    "Path": {
        "lineColor": "#6b7280",
        "glowColor": "#9ca3af",
        "lineWidth": 2.5,
        "glowWidth": 5,
        "glowOpacity": 0.45,
        "markerColor": "#f9fafb",
        "markerGlowColor": "#9ca3af",
    },
    "Foot Path": {
        "lineColor": "#16a34a",
        "glowColor": "#16a34a",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.5,
        "markerColor": "#dcfce7",
        "markerGlowColor": "#16a34a",
    },
    "Marked Crossing": {
        "lineColor": "#f97316",
        "glowColor": "#f97316",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.55,
        "markerColor": "#fffbeb",
        "markerGlowColor": "#f97316",
    },
    "Pavement": {
        "lineColor": "#64748b",
        "glowColor": "#94a3b8",
        "lineWidth": 2.5,
        "glowWidth": 5,
        "glowOpacity": 0.5,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#94a3b8",
    },
    "Informal Path": {
        "lineColor": "#facc15",
        "glowColor": "#facc15",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.5,
        "markerColor": "#fefce8",
        "markerGlowColor": "#facc15",
    },
    "Steps": {
        "lineColor": "#9f1239",
        "glowColor": "#9f1239",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.55,
        "markerColor": "#fef2f2",
        "markerGlowColor": "#9f1239",
    },
    "Cycle Path": {
        "lineColor": "#0ea5e9",
        "glowColor": "#0ea5e9",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.5,
        "markerColor": "#e0f2fe",
        "markerGlowColor": "#0ea5e9",
    },
    "Bridle Way": {
        "lineColor": "#7c2d12",
        "glowColor": "#7c2d12",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.5,
        "markerColor": "#ffedd5",
        "markerGlowColor": "#7c2d12",
    },
    "Pedestrian Street": {
        "lineColor": "#ea580c",
        "glowColor": "#ea580c",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.55,
        "markerColor": "#fffbeb",
        "markerGlowColor": "#ea580c",
    },
    # Waterways
    "Stream": {
        "lineColor": "#38bdf8",
        "glowColor": "#38bdf8",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.55,
        "markerColor": "#e0f2fe",
        "markerGlowColor": "#38bdf8",
    },
    "Drain": {
        "lineColor": "#0284c7",
        "glowColor": "#0284c7",
        "lineWidth": 2.25,
        "glowWidth": 5,
        "glowOpacity": 0.5,
        "markerColor": "#e0f2fe",
        "markerGlowColor": "#0284c7",
    },
    "River": {
        "lineColor": "#1d4ed8",
        "glowColor": "#1d4ed8",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.6,
        "markerColor": "#dbeafe",
        "markerGlowColor": "#1d4ed8",
    },
    "Canal": {
        "lineColor": "#0f766e",
        "glowColor": "#0f766e",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.55,
        "markerColor": "#ccfbf1",
        "markerGlowColor": "#0f766e",
    },
    "Ditch": {
        "lineColor": "#166534",
        "glowColor": "#166534",
        "lineWidth": 2.25,
        "glowWidth": 5,
        "glowOpacity": 0.5,
        "markerColor": "#dcfce7",
        "markerGlowColor": "#166534",
    },
    # Barriers
    "Fence": {
        "lineColor": "#4b5563",
        "glowColor": "#111827",
        "lineWidth": 2,
        "glowWidth": 5,
        "glowOpacity": 0.55,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#111827",
    },
    "Guard Rail": {
        "lineColor": "#57534e",
        "glowColor": "#1f2933",
        "lineWidth": 2.25,
        "glowWidth": 5,
        "glowOpacity": 0.55,
        "markerColor": "#f9fafb",
        "markerGlowColor": "#1f2933",
    },
    "Wall": {
        "lineColor": "#44403c",
        "glowColor": "#020617",
        "lineWidth": 2.5,
        "glowWidth": 5,
        "glowOpacity": 0.6,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#020617",
    },
    "Retaining Wall": {
        "lineColor": "#475569",
        "glowColor": "#f97316",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.6,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#f97316",
    },
    "Kerb": {
        "lineColor": "#9f1239",
        "glowColor": "#9f1239",
        "lineWidth": 2,
        "glowWidth": 5,
        "glowOpacity": 0.55,
        "markerColor": "#fee2e2",
        "markerGlowColor": "#9f1239",
    },
    "Gate": {
        "lineColor": "#a16207",
        "glowColor": "#a16207",
        "lineWidth": 2.25,
        "glowWidth": 5,
        "glowOpacity": 0.6,
        "markerColor": "#fef9c3",
        "markerGlowColor": "#a16207",
    },
    "Hedge": {
        "lineColor": "#166534",
        "glowColor": "#166534",
        "lineWidth": 2,
        "glowWidth": 5,
        "glowOpacity": 0.55,
        "markerColor": "#dcfce7",
        "markerGlowColor": "#166534",
    },
    "Trench": {
        "lineColor": "#7f1d1d",
        "glowColor": "#7f1d1d",
        "lineWidth": 2.25,
        "glowWidth": 5,
        "glowOpacity": 0.6,
        "markerColor": "#fee2e2",
        "markerGlowColor": "#7f1d1d",
    },
    "Barrier": {
        "lineColor": "#e11d48",
        "glowColor": "#e11d48",
        "lineWidth": 2.5,
        "glowWidth": 6,
        "glowOpacity": 0.65,
        "markerColor": "#ffe4e6",
        "markerGlowColor": "#e11d48",
    },
    # Natural features
    "Coast Line": {
        "lineColor": "#0369a1",
        "glowColor": "#0369a1",
        "lineWidth": 4,
        "glowWidth": 9,
        "glowOpacity": 0.65,
        "markerColor": "#e0f2fe",
        "markerGlowColor": "#0369a1",
    },
    "Tree Row": {
        "lineColor": "#15803d",
        "glowColor": "#15803d",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.6,
        "markerColor": "#bbf7d0",
        "markerGlowColor": "#15803d",
    },
    "Cliff": {
        "lineColor": "#991b1b",
        "glowColor": "#991b1b",
        "lineWidth": 3,
        "glowWidth": 7,
        "glowOpacity": 0.65,
        "markerColor": "#fee2e2",
        "markerGlowColor": "#991b1b",
    },
    # Utility features
    "Power Line": {
        "lineColor": "#334155",
        "glowColor": "#38bdf8",
        "lineWidth": 2,
        "glowWidth": 5,
        "glowOpacity": 0.6,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#38bdf8",
    },
    "Minor Power Line": {
        "lineColor": "#526a82",
        "glowColor": "#38bdf8",
        "lineWidth": 1.75,
        "glowWidth": 4.5,
        "glowOpacity": 0.55,
        "markerColor": "#e5e7eb",
        "markerGlowColor": "#38bdf8",
    },
    "Pipeline": {
        "lineColor": "#15803d",
        "glowColor": "#15803d",
        "lineWidth": 2.25,
        "glowWidth": 5,
        "glowOpacity": 0.6,
        "markerColor": "#bbf7d0",
        "markerGlowColor": "#15803d",
    },
    "Power Cable": {
        "lineColor": "#9333ea",
        "glowColor": "#9333ea",
        "lineWidth": 2,
        "glowWidth": 5,
        "glowOpacity": 0.6,
        "markerColor": "#f5f3ff",
        "markerGlowColor": "#9333ea",
    },
}


def get_catalog() -> SymbologyCatalog:
    """
    Build the current symbology catalog structure.

    This helper centralizes the shape returned to the frontend and is the
    single place to tweak versioning or add additional top-level metadata.
    All line symbologies use SYMBOL_LINE_WIDTH for stroke thickness; road
    closure (dotted red) is handled in the frontend, not in this catalog.
    """
    styles = {}
    for label, style in STYLES_BY_LABEL.items():
        styles[label] = {**style, "lineWidth": SYMBOL_LINE_WIDTH}
    return {
        "version": SYMBOL_VERSION,
        "styles_by_label": styles,
    }

