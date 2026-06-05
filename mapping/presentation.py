"""Template and URL helpers for My Edits pages."""

from django.contrib.auth import logout
from django.shortcuts import redirect
from django.urls import reverse

def user_is_manager(user) -> bool:
    profile = getattr(user, "profile", None)
    return bool(profile and profile.role == "manager")


def user_edits_apply_immediately(user) -> bool:
    """Managers and system admins apply edits live; editors require manager review."""
    if user.is_superuser:
        return True
    return user_is_manager(user)


def user_submissions_require_manager_review(user) -> bool:
    """True when map edits and layer uploads must enter the manager approval queue."""
    return not user_edits_apply_immediately(user)


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
        "my_edits_show_pending_rejected_filters": user_submissions_require_manager_review(
            user
        ),
    }


def review_history_page_context() -> dict:
    return {
        "review_history_api_url": reverse("mapping:list_manager_review_history"),
        "review_history_map_url": reverse("manager:map"),
    }
