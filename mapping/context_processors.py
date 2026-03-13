"""Context processors for the mapping app."""
from django.conf import settings


def maptiler_api_key(request):
    """Inject MapTiler API key into template context for map pages."""
    return {
        'maptiler_api_key': settings.MAPTILER_API_KEY,
    }


def riyadh_roads_tile_url(request):
    """Inject Riyadh roads tile URL into template context."""
    return {
        'riyadh_roads_tile_url': getattr(settings, 'RIYADH_ROADS_TILE_URL', '').strip(),
    }
