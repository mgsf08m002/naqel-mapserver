from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout
from django.urls import reverse
from django.http import JsonResponse
from system_admin.models import UserProfile


@login_required(login_url='/login/')
def map_view(request):
    """Editor Map view - landing page after login."""
    if not hasattr(request.user, "profile") or request.user.profile.role != "editor":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    if not request.user.profile.password_setup_completed:
        messages.info(
            request,
            "Set your password to finish signing in.",
        )
        return redirect("auth:password_setup")
    return render(request, 'editor/map.html')


@login_required(login_url='/login/')
def account_information_view(request):
    """Account Information view."""
    # Require an editor profile.
    if not hasattr(request.user, "profile") or request.user.profile.role != "editor":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    # Require account-information permission.
    if not request.user.profile.can_access_account_information:
        logout(request)
        return redirect(
            "auth:login?no_permission=1&permission_type=account_information"
        )
    
    # Ensure a profile record exists for the current editor.
    profile, created = UserProfile.objects.get_or_create(user=request.user)
    
    # Backfill account creation timestamp when missing.
    if not profile.account_creation_date:
        profile.set_account_creation_datetime()
    
    context = {'profile': profile}

    if request.method == 'POST':
        intent = request.POST.get('intent')
        if intent == 'update_profile':
            errors = []
            full_name = request.POST.get('full_name', '').strip()

            if not full_name:
                errors.append('Full name is required.')

            if not errors:
                # Editors can update only their display name here.
                user = request.user
                user.first_name = full_name
                user.last_name = ""
                user.save()

                messages.success(request, "Profile updated.")
            else:
                for err in errors:
                    messages.error(request, err)

    return render(request, 'editor/account_information.html', context)


@login_required(login_url='/login/')
def security_view(request):
    """Security view."""
    # Require an editor profile.
    if not hasattr(request.user, "profile") or request.user.profile.role != "editor":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    # Require security permission.
    if not request.user.profile.can_access_security:
        logout(request)
        return redirect("auth:login?no_permission=1&permission_type=security")

    context = {}

    if request.method == 'POST':
        intent = request.POST.get('intent')

        if intent == 'change_password':
            errors = []
            current_password = request.POST.get('current_password', '').strip()
            new_password = request.POST.get('new_password', '').strip()
            confirm_password = request.POST.get('confirm_password', '').strip()

            if not current_password or not new_password or not confirm_password:
                errors.append('All password fields are required.')

            if current_password and not request.user.check_password(current_password):
                errors.append('Current password is incorrect.')

            if new_password and len(new_password) < 8:
                errors.append('New password must be at least 8 characters long.')

            if new_password and confirm_password and new_password != confirm_password:
                errors.append('New passwords do not match.')

            if not errors:
                user = request.user
                user.set_password(new_password)
                user.save()
                logout(request)
                return redirect('/login/?password_changed=1')
            else:
                for err in errors:
                    messages.error(request, err)

    return render(request, "editor/security.html", context)


@login_required(login_url='/login/')
def upload_profile_image_view(request):
    """Handle profile image upload."""
    # Only editors can upload a profile image from this view.
    if not hasattr(request.user, 'profile') or request.user.profile.role != 'editor':
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized',
            'notification': {'message': 'Unauthorized', 'type': 'error'}
        }, status=403)
    
    if request.method == 'POST' and request.FILES.get('profile_image'):
        profile, created = UserProfile.objects.get_or_create(user=request.user)
        # Remove any previous image before saving the new one.
        if profile.profile_image:
            profile.profile_image.delete()
        profile.profile_image = request.FILES['profile_image']
        profile.save()
        return JsonResponse({
            'success': True,
            'message': 'Profile image uploaded successfully',
            'image_url': profile.profile_image.url,
            'notification': {'message': 'Profile image uploaded successfully', 'type': 'success'}
        })
    
    return JsonResponse({
        'success': False,
        'message': 'No image provided',
        'notification': {'message': 'No image provided', 'type': 'error'}
    }, status=400)


@login_required(login_url='/login/')
def remove_profile_image_view(request):
    """Handle profile image removal."""
    # Only editors can remove a profile image from this view.
    if not hasattr(request.user, 'profile') or request.user.profile.role != 'editor':
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized',
            'notification': {'message': 'Unauthorized', 'type': 'error'}
        }, status=403)
    
    if request.method == 'POST':
        try:
            profile = UserProfile.objects.get(user=request.user)
            if profile.profile_image:
                profile.profile_image.delete()
                profile.profile_image = None
                profile.save()
            return JsonResponse({
                'success': True,
                'message': 'Profile image removed successfully',
                'notification': {'message': 'Profile image removed successfully', 'type': 'success'}
            })
        except UserProfile.DoesNotExist:
            return JsonResponse({
                'success': True,
                'message': 'Profile image removed successfully',
                'notification': {'message': 'Profile image removed successfully', 'type': 'success'}
            })
    
    return JsonResponse({
        'success': False,
        'message': 'Invalid request',
        'notification': {'message': 'Invalid request', 'type': 'error'}
    }, status=400)
