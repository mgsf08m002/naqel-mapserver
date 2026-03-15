from .models import UserProfile


def user_profile(request):
    """Ensure a user profile is available in templates for admins, managers, and editors."""
    if request.user.is_authenticated:
        # System admins always use a profile record.
        if request.user.is_superuser:
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            return {'user_profile': profile}
        # Managers and editors use their attached profile when present.
        elif hasattr(request.user, 'profile'):
            return {'user_profile': request.user.profile}
        else:
            # Fallback: create a profile for managers/editors when missing.
            try:
                profile, created = UserProfile.objects.get_or_create(user=request.user)
                return {'user_profile': profile}
            except Exception:
                return {'user_profile': None}
    return {'user_profile': None}

