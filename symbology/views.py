from django.http import JsonResponse
from django.views.decorators.http import require_GET

from mapping.riyadh_fclass import merged_riyadh_fclass_payload_for_catalog

from .catalog_service import get_catalog
from .labeling_config import get_road_labeling_config


@require_GET
def symbology_catalog(request):
    """JSON catalog: ``symbology.json`` styles plus merged Riyadh fclass maps and road labeling."""

    catalog = get_catalog()
    road_labeling = get_road_labeling_config()
    riyadh_fclass = merged_riyadh_fclass_payload_for_catalog(catalog["styles_by_label"])
    payload = {
        **catalog,
        **riyadh_fclass,
        "road_labeling": road_labeling,
    }
    response = JsonResponse(payload)
    response["Access-Control-Allow-Origin"] = "*"
    response["Cache-Control"] = "no-store, max-age=0"
    return response

