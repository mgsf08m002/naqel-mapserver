from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.shortcuts import redirect, render

from .models import UserProfile


ACCOUNT_PAGE_COPY = {
    'admin': {
        'role_label': 'System Administrator',
        'subtitle': 'Manage your profile image and review the key details linked to your admin account.',
    },
    'manager': {
        'role_label': 'Manager',
        'subtitle': 'Manage your profile image and review the key details linked to your manager account.',
    },
    'editor': {
        'role_label': 'Editor',
        'subtitle': 'Manage your profile image and review the key details linked to your editor account.',
    },
}


def account_page_context(request, audience, profile, is_editing=False, full_name=None, email=None):
    """Shared context for the Account Information profile overview."""
    copy = ACCOUNT_PAGE_COPY[audience]
    resolved_name = (full_name or request.user.get_full_name() or request.user.username).strip()
    resolved_email = (email if email is not None else request.user.email) or ''
    return {
        'profile': profile,
        'account_full_name': resolved_name,
        'account_email': resolved_email,
        'account_initials': (resolved_name[:1] or 'A').upper(),
        'account_role_label': copy['role_label'],
        'account_subtitle': copy['subtitle'],
        'account_status': 'Active' if request.user.is_active else 'Inactive',
        'account_is_active': request.user.is_active,
        'is_editing': is_editing,
    }


def handle_account_profile_post(request):
    """Update only email and full name. Returns (errors, email_changed, full_name, email)."""
    errors = []
    full_name = request.POST.get('full_name', '').strip()
    email = request.POST.get('email', '').strip()

    if not full_name:
        errors.append('Full name is required.')

    if not email:
        errors.append('Email is required.')
    else:
        try:
            validate_email(email)
        except ValidationError:
            errors.append('Please provide a valid email.')
        else:
            if User.objects.filter(username=email).exclude(pk=request.user.pk).exists():
                errors.append('This email is already in use.')

    if errors:
        return errors, False, full_name, email

    user = request.user
    email_changed = user.email != email or user.username != email
    name_parts = full_name.split()
    user.first_name = name_parts[0] if name_parts else ''
    user.last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
    user.email = email
    user.username = email
    user.save()
    return [], email_changed, full_name, email


def render_account_page(request, audience, template_name):
    """Load, update, and render the Account Information page."""
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    if not profile.account_creation_date:
        profile.set_account_creation_datetime()

    context = account_page_context(request, audience, profile)

    if request.method == 'POST' and request.POST.get('intent') == 'update_profile':
        errors, email_changed, full_name, email = handle_account_profile_post(request)
        if errors:
            for err in errors:
                messages.error(request, err)
            context = account_page_context(
                request, audience, profile, is_editing=True, full_name=full_name, email=email
            )
        elif email_changed:
            logout(request)
            return redirect('/login/?email_changed=1')
        else:
            messages.success(request, 'Profile updated.')
            context = account_page_context(request, audience, profile)

    return render(request, template_name, context)
