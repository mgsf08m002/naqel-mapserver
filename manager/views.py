from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout
from django.urls import reverse
from django.http import JsonResponse
from config.ui_strings import t
from system_admin.account import (
    remove_profile_image,
    render_account_page,
    upload_profile_image,
)
from system_admin.security_page import render_security_page


def _ui_lang(request) -> str:
    return getattr(request, "ui_language", None) or "en"
from mapping.presentation import (
    enforce_my_edits_access,
    my_edits_page_context,
    review_history_page_context,
)


@login_required(login_url='/login/')
def map_view(request):
    """Manager Map view - landing page after login."""
    if not hasattr(request.user, "profile") or request.user.profile.role != "manager":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    if not request.user.profile.password_setup_completed:
        messages.info(
            request,
            "Set your password to finish signing in.",
        )
        return redirect("auth:password_setup")
    return render(request, 'manager/map.html')


@login_required(login_url='/login/')
def account_information_view(request):
    """Account Information view."""
    if not hasattr(request.user, "profile") or request.user.profile.role != "manager":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    if not request.user.profile.can_access_account_information:
        logout(request)
        return redirect(
            "auth:login?no_permission=1&permission_type=account_information"
        )
    return render_account_page(request, 'manager', 'manager/account_information.html')


@login_required(login_url='/login/')
def security_view(request):
    """Security view."""
    if not hasattr(request.user, "profile") or request.user.profile.role != "manager":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    if not request.user.profile.can_access_security:
        logout(request)
        return redirect("auth:login?no_permission=1&permission_type=security")

    return render_security_page(request, "manager", "manager/security.html")


@login_required(login_url='/login/')
def upload_profile_image_view(request):
    """Handle profile image upload."""
    if not hasattr(request.user, 'profile') or request.user.profile.role != 'manager':
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
        }, status=403)
    return upload_profile_image(request)


@login_required(login_url='/login/')
def remove_profile_image_view(request):
    """Handle profile image removal."""
    if not hasattr(request.user, 'profile') or request.user.profile.role != 'manager':
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
        }, status=403)
    return remove_profile_image(request)


@login_required(login_url='/login/')
def my_edits_view(request):
    """My Edits history for the manager."""
    if not hasattr(request.user, "profile") or request.user.profile.role != "manager":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    denied = enforce_my_edits_access(request)
    if denied:
        return denied

    context = my_edits_page_context(request.user)
    return render(request, "manager/my_edits.html", context)


@login_required(login_url='/login/')
def review_history_view(request):
    """Approved/rejected editor submissions for managers."""
    if not hasattr(request.user, "profile") or request.user.profile.role != "manager":
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    if not request.user.profile.password_setup_completed:
        messages.info(
            request,
            "Set your password to finish signing in.",
        )
        return redirect("auth:password_setup")

    context = review_history_page_context()
    return render(request, "manager/review_history.html", context)
