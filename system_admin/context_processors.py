from .models import UserProfile


def user_profile(request):
    """Context processor to ensure user profile exists for system admin and managers."""
    if request.user.is_authenticated:
        # For system admins
        if request.user.is_superuser:
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            return {'user_profile': profile}
        # For managers and editors
        elif hasattr(request.user, 'profile'):
            return {'user_profile': request.user.profile}
        else:
            # Try to get or create profile for managers/editors
            try:
                profile, created = UserProfile.objects.get_or_create(user=request.user)
                return {'user_profile': profile}
            except:
                return {'user_profile': None}
    return {'user_profile': None}

