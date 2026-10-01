"""Context processors for the mapping app."""

from django.conf import settings

from .approval_categories import EDIT_FILTER_CATEGORIES
from .riyadh_network import riyadh_tiles_absolute_url


def maptiler_api_key(request):
    """Inject MapTiler API key into template context for map pages."""
    return {
        "maptiler_api_key": settings.MAPTILER_API_KEY,
    }


def riyadh_roads_tile_url(request):
    """Inject the Riyadh roads tile URL for MapLibre (Nginx auth_request -> Martin)."""
    return {"riyadh_roads_tile_url": riyadh_tiles_absolute_url(request)}


def edit_filter_categories(request):
    """Shared road-type filter labels for list pages and the manager approval queue."""
    return {"edit_filter_categories": EDIT_FILTER_CATEGORIES}
