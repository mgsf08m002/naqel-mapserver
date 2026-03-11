from __future__ import annotations

from .feature_catalog import SymbologyCatalog, get_catalog as _get_catalog_from_json


def get_catalog() -> SymbologyCatalog:
    """
    Build the current symbology catalog structure.

    This delegate simply returns the catalog loaded from symbology/symbology.json
    via feature_catalog.get_catalog(). The JSON file is the single source of
    truth for all symbology in the project.
    """
    return _get_catalog_from_json()

