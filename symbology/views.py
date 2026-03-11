from django.http import JsonResponse
from django.views.decorators.http import require_GET
from django.contrib.auth.decorators import login_required

from .catalog_service import get_catalog


@login_required
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

