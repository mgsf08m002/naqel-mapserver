"""Template context for layer upload (manager menu badge)."""

from .services import pending_manager_layer_count


def manager_pending_layers(request):
    """Pending layer count for managers (menu badge)."""
    if not request.user.is_authenticated:
        return {"manager_pending_layer_count": 0}

    profile = getattr(request.user, "profile", None)
    if not profile or profile.role != "manager":
        return {"manager_pending_layer_count": 0}

    return {"manager_pending_layer_count": pending_manager_layer_count()}
