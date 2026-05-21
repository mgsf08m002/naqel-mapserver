"""Context processors for the mapping app."""

from django.conf import settings

from .riyadh_network import riyadh_tile_proxy_absolute_url


def maptiler_api_key(request):
    """Inject MapTiler API key into template context for map pages."""
    return {
        "maptiler_api_key": settings.MAPTILER_API_KEY,
    }


def riyadh_roads_tile_url(request):
    """Inject Riyadh roads tile proxy URL for MapLibre (via Django, not Martin direct)."""
    return {"riyadh_roads_tile_url": riyadh_tile_proxy_absolute_url(request)}
