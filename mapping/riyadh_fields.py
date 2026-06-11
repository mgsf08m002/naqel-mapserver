"""Shared Riyadh road field and tag conventions for API + approval."""

from __future__ import annotations

import math
from decimal import Decimal

# Sidebar controls: name + closure; mirrored UI-only keys excluded from tag rows.
RIYADH_SIDEBAR_EXCLUSIVE_FIELD_KEYS = frozenset({"name", "road_closure"})
RIYADH_FIELDS_UI_ONLY = frozenset({"common_name", "multilingual_names"})
RIYADH_FIELDS_OMIT_FROM_TAGS = RIYADH_SIDEBAR_EXCLUSIVE_FIELD_KEYS | RIYADH_FIELDS_UI_ONLY

# DB identifiers present in payloads but not reviewable attribute edits.
RIYADH_FIELDS_NON_REVIEWABLE = frozenset({"gid", "id", "objectid"})


def riyadh_decimal_eq(a, b) -> bool:
    """Compare numeric road attributes from client payloads vs DB decimals."""
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
        return str(a or "").strip() == str(b or "").strip()
    if fa is None and fb is None:
        return True
    if fa is None or fb is None:
        return False
    return math.isclose(fa, fb, rel_tol=0, abs_tol=1e-5)
