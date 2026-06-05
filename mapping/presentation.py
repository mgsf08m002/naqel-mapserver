"""Template and URL helpers for My Edits pages."""

from django.contrib.auth import logout
from django.shortcuts import redirect
from django.urls import reverse

from .approval_categories import EDIT_FILTER_CATEGORIES


def has_my_edits_access(user) -> bool:
    if user.is_superuser:
        return True
    profile = getattr(user, "profile", None)
    if not profile:
        return False
    if profile.role not in {"manager", "editor"}:
        return False
    return bool(profile.can_access_my_edits)


def enforce_my_edits_access(request):
    if has_my_edits_access(request.user):
        return None
    logout(request)
    return redirect(
        f"{reverse('auth:login')}?no_permission=1&permission_type=my_edits"
    )


def my_edits_map_url(user) -> str:
    if user.is_superuser:
        return reverse("system_admin:map")
    profile = getattr(user, "profile", None)
    if profile and profile.role == "manager":
        return reverse("manager:map")
    return reverse("editor:map")


def my_edits_page_context(user) -> dict:
    return {
        "my_edits_api_url": reverse("mapping:list_my_edit_requests"),
        "my_edits_map_url": my_edits_map_url(user),
        "edit_filter_categories": EDIT_FILTER_CATEGORIES,
    }


def review_history_page_context() -> dict:
    return {
        "review_history_api_url": reverse("mapping:list_manager_review_history"),
        "review_history_map_url": reverse("manager:map"),
        "edit_filter_categories": EDIT_FILTER_CATEGORIES,
    }
