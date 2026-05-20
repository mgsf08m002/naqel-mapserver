"""Template context for layer upload (manager menu badge)."""

from .services import pending_upload_approval_count


def manager_upload_approvals(request):
    """
    Pending upload batches for the manager menu badge.
    Only populated for authenticated users with role ``manager``.
    """
    if not request.user.is_authenticated:
        return {"manager_upload_approval_count": 0}

    profile = getattr(request.user, "profile", None)
    if not profile or profile.role != "manager":
        return {"manager_upload_approval_count": 0}

    return {"manager_upload_approval_count": pending_upload_approval_count()}
