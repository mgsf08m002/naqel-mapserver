import logging

from django.conf import settings
from django.http import HttpResponse
from django.utils.crypto import constant_time_compare
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .services import authorize_tile_request

logger = logging.getLogger(__name__)


def _shared_secret_ok(request) -> bool:
    expected = getattr(settings, "TILE_AUTH_SHARED_SECRET", "")
    if not expected:
        # No secret is configured: only tolerated in local DEBUG runs.
        return bool(settings.DEBUG)
    return constant_time_compare(request.headers.get("X-Tile-Auth-Secret", ""), expected)


@never_cache
@require_GET
def validate_tile_request(request):
    """
    Nginx ``auth_request`` target. Returns 204 (allow), 401 (no credentials) or 403 (refused).

    Nginx forwards the original tile URI in X-Original-URI. Cookies and
    Authorization are forwarded too, because auth subrequests copy the client's headers.
    """
    if not _shared_secret_ok(request):
        logger.warning("Tile auth called without a valid shared secret from %s", request.META.get("REMOTE_ADDR"))
        return HttpResponse(status=403)

    decision = authorize_tile_request(request, request.headers.get("X-Original-URI", ""))
    response = HttpResponse(status=decision.status)
    response["X-Tile-Token-Id"] = decision.token_label
    if not decision.allowed:
        logger.info("Tile request refused (%s): %s", decision.status, decision.reason)
    return response
