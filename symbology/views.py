from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .catalog_service import get_catalog


@require_GET
def symbology_catalog(request):
    """
    Return the centralized symbology catalog used by the map frontend.

    The response is intentionally small and cache-friendly. It is safe to
    cache aggressively on the client side; changes are tracked via the
    `version` field in the payload.
    """

    catalog = get_catalog()
    return JsonResponse(catalog)

