"""Access control for the layer upload workflow."""

from django.contrib.auth import logout
from django.shortcuts import redirect
from django.urls import reverse

from .models import Layer


def is_layer_upload_manager(user) -> bool:
    """True when the user can publish uploads without map review (manager role only)."""
    profile = getattr(user, "profile", None)
    return bool(profile and profile.role == "manager")


def has_layer_uploader_access(user) -> bool:
    if user.is_superuser:
        return True
    profile = getattr(user, "profile", None)
    if not profile:
        return False
    if profile.role not in {"manager", "editor"}:
        return False
    return bool(profile.can_access_layer_uploader)


def enforce_layer_uploader_access(request):
    if has_layer_uploader_access(request.user):
        return None
    logout(request)
    return redirect(
        f"{reverse('auth:login')}?no_permission=1&permission_type=layer_uploader"
    )


def can_access_uploader_review(user, layer: Layer) -> bool:
    if not has_layer_uploader_access(user):
        return False
    if user.is_superuser:
        return True
    return layer.uploaded_by_id == user.id and layer.status == Layer.Status.DRAFT


def enforce_uploader_review_access(request, layer: Layer):
    if can_access_uploader_review(request.user, layer):
        return None
    logout(request)
    return redirect(
        f"{reverse('auth:login')}?no_permission=1&permission_type=layer_uploader"
    )
