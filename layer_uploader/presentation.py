"""Template and URL helpers for layer upload pages."""

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


def review_page_context(request, layer: Layer) -> dict:
    """Layer review template context (tile URL / MapTiler key come from context processors)."""
    return {
        "base_template": resolve_base_template(request.user),
        "layer": layer,
        "can_submit": layer.status == Layer.Status.DRAFT,
        "is_manager_uploader": is_layer_upload_manager(request.user),
    }
