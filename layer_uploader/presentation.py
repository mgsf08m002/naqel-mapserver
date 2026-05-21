"""Template and URL helpers for layer upload pages."""

from django.conf import settings
from django.urls import reverse

from .access import is_layer_upload_manager
from .models import Layer


def resolve_base_template(user) -> str:
    if user.is_superuser:
        return "system_admin/base.html"
    profile = getattr(user, "profile", None)
    if profile and profile.role == "manager":
        return "manager/base.html"
    if profile and profile.role == "editor":
        return "editor/base.html"
    return "system_admin/base.html"


def post_upload_map_url(user) -> str:
    if user.is_superuser:
        return reverse("system_admin:map")
    profile = getattr(user, "profile", None)
    if profile and profile.role == "manager":
        return reverse("manager:map")
    if profile and profile.role == "editor":
        return reverse("editor:map")
    return reverse("landing")


def riyadh_tile_proxy_url(request) -> str:
    if not getattr(settings, "RIYADH_ROADS_TILE_URL", "").strip():
        return ""
    return (
        f"{request.scheme}://{request.get_host()}"
        "/mapping/tiles/riyadh_roads/{z}/{x}/{y}/"
    )


def review_page_context(request, layer: Layer) -> dict:
    return {
        "base_template": resolve_base_template(request.user),
        "layer": layer,
        "riyadh_roads_tile_url": riyadh_tile_proxy_url(request),
        "maptiler_api_key": settings.MAPTILER_API_KEY or "",
        "can_submit": layer.status == Layer.Status.DRAFT,
        "is_manager_uploader": is_layer_upload_manager(request.user),
    }
