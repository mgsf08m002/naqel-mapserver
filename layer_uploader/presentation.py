"""Template and URL helpers for layer upload pages."""

from django.urls import reverse

from .access import is_layer_upload_manager
from .constants import LARGE_LAYER_FEATURE_THRESHOLD, TABLE_PAGE_SIZE_DEFAULT
from .models import Layer


def _user_profile(user):
    return getattr(user, "profile", None)


def _map_namespace_for_user(user) -> str:
    """URL namespace for the user's primary map view."""
    if user.is_superuser:
        return "system_admin"
    profile = _user_profile(user)
    if profile and profile.role == "manager":
        return "manager"
    if profile and profile.role == "editor":
        return "editor"
    return "system_admin"


def resolve_base_template(user) -> str:
    return f"{_map_namespace_for_user(user)}/base.html"


def post_upload_map_url(user) -> str:
    if user.is_superuser:
        return reverse("system_admin:map")
    profile = _user_profile(user)
    if profile and profile.role == "manager":
        return reverse("manager:map")
    if profile and profile.role == "editor":
        return reverse("editor:map")
    return reverse("landing")


def upload_flow_context(request, **extra) -> dict:
    """Shared template context for upload, validate, and success pages."""
    return {
        "base_template": resolve_base_template(request.user),
        "upload_reset_url": reverse("upload"),
        **extra,
    }


def review_page_context(request, layer: Layer) -> dict:
    """Layer review template context (tile URL / MapTiler key come from context processors)."""
    staged_count = layer.features.count()
    return {
        "base_template": resolve_base_template(request.user),
        "layer": layer,
        "can_submit": layer.status == Layer.Status.DRAFT,
        "is_manager_uploader": is_layer_upload_manager(request.user),
        "review_total_features": int(layer.total_features or staged_count),
        "review_new_features": int(layer.new_features or staged_count),
        "review_large_layer": staged_count > LARGE_LAYER_FEATURE_THRESHOLD,
        "review_page_size": TABLE_PAGE_SIZE_DEFAULT,
    }
