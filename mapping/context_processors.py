"""Context processors for the mapping app."""
from django.conf import settings


def maptiler_api_key(request):
    """Inject MapTiler API key into template context for map pages."""
    return {
        'maptiler_api_key': settings.MAPTILER_API_KEY,
    }


def riyadh_roads_tile_url(request):
    """Inject Riyadh roads tile URL into template context."""
    upstream = getattr(settings, 'RIYADH_ROADS_TILE_URL', '').strip()
    if not upstream:
        return {'riyadh_roads_tile_url': ''}

    # Keep placeholders unescaped (`{z}/{x}/{y}`) for MapLibre template substitution.
    absolute_template = (
        f"{request.scheme}://{request.get_host()}"
        "/mapping/tiles/riyadh_roads/{z}/{x}/{y}/"
    )
    return {
        'riyadh_roads_tile_url': absolute_template,
    }
