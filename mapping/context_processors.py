"""
Context processors for the mapping app.
"""
from django.conf import settings


def maptiler_api_key(request):
    """Inject MapTiler API key into template context for map pages."""
    return {
        'maptiler_api_key': settings.MAPTILER_API_KEY,
    }
