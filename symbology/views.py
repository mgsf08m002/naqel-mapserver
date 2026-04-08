from django.http import JsonResponse
from django.views.decorators.http import require_GET

from mapping.riyadh_fclass import riyadh_fclass_map_payload

from .catalog_service import get_catalog
from .labeling_config import get_road_labeling_config


@require_GET
def symbology_catalog(request):
    """
    Return the centralized symbology catalog used by the map frontend.

    Merges `riyadh_fclass_to_label`, `riyadh_fclass_keys`, and
    `riyadh_label_to_fclass` from mapping/riyadh_fclass.py so the map uses the
    same fclass ↔ label mapping as the remote DB API. Line styles come only from
    symbology/symbology.json (validated against those labels at load time).

    The response is intentionally small and cache-friendly. It is safe to
    cache aggressively on the client side; changes are tracked via the
    `version` field in the payload.
    """

    catalog = get_catalog()
    road_labeling = get_road_labeling_config()
    payload = {
        **catalog,
        **riyadh_fclass_map_payload(),
        "road_labeling": road_labeling,
    }
    return JsonResponse(payload)

