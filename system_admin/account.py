from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.shortcuts import redirect, render

from config.ui_strings import t

from .models import UserProfile


_AUDIENCE_ROLE_KEY = {
    'admin': 'acct_role_admin',
    'manager': 'role_manager',
    'editor': 'role_editor',
}

_AUDIENCE_SUBTITLE_KEY = {
    'admin': 'acct_subtitle_admin',
    'manager': 'acct_subtitle_manager',
    'editor': 'acct_subtitle_editor',
}


def _ui_lang(request) -> str:
    return getattr(request, 'ui_language', None) or 'en'


def _format_account_date(value, lang: str) -> str | None:
    from .views import _format_users_date

    return _format_users_date(value, lang, full=True)


def _format_account_time(value, lang: str) -> str | None:
    from .views import _format_users_time

    return _format_users_time(value, lang)


def account_page_context(request, audience, profile, is_editing=False, full_name=None, email=None):
    """Shared context for the Account Information profile overview."""
    lang = _ui_lang(request)
    resolved_name = (full_name or request.user.get_full_name() or request.user.username).strip()
    resolved_email = (email if email is not None else request.user.email) or ''
    created_date = (
        _format_account_date(profile.account_creation_date, lang)
        if profile.account_creation_date
        else t(lang, 'not_set')
    )
    created_time = (
        _format_account_time(profile.account_creation_time, lang)
        if profile.account_creation_time
        else t(lang, 'not_set')
    )
    return {
        'profile': profile,
        'account_full_name': resolved_name,
        'account_email': resolved_email,
        'account_initials': (resolved_name[:1] or 'A').upper(),
        'account_role_label': t(lang, _AUDIENCE_ROLE_KEY[audience]),
        'account_subtitle': t(lang, _AUDIENCE_SUBTITLE_KEY[audience]),
        'account_status': t(lang, 'active' if request.user.is_active else 'inactive'),
        'account_is_active': request.user.is_active,
        'account_created_date_display': created_date,
        'account_created_time_display': created_time,
        'is_editing': is_editing,
    }


def handle_account_profile_post(request):
    """Update only email and full name. Returns (errors, email_changed, full_name, email)."""
    lang = _ui_lang(request)
    errors = []
    full_name = request.POST.get('full_name', '').strip()
    email = request.POST.get('email', '').strip()

    if not full_name:
        errors.append(t(lang, 'msg_acct_full_name_required'))

    if not email:
        errors.append(t(lang, 'msg_acct_email_required'))
    else:
        try:
            validate_email(email)
        except ValidationError:
            errors.append(t(lang, 'msg_acct_email_invalid'))
        else:
            if User.objects.filter(username=email).exclude(pk=request.user.pk).exists():
                errors.append(t(lang, 'msg_acct_email_in_use'))

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
    lang = _ui_lang(request)

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
            messages.success(request, t(lang, 'msg_acct_profile_updated'))
            context = account_page_context(request, audience, profile)

    return render(request, template_name, context)


def upload_profile_image(request):
    """Save a new profile photo for the current user (JSON)."""
    lang = _ui_lang(request)
    if request.method == 'POST' and request.FILES.get('profile_image'):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        if profile.profile_image:
            profile.profile_image.delete()
        profile.profile_image = request.FILES['profile_image']
        profile.save()
        return JsonResponse({
            'success': True,
            'message': t(lang, 'toast_photo_updated'),
            'image_url': profile.profile_image.url,
        })
    return JsonResponse({
        'success': False,
        'message': t(lang, 'msg_acct_no_image'),
    }, status=400)


def remove_profile_image(request):
    """Clear the current user's profile photo (JSON)."""
    lang = _ui_lang(request)
    if request.method == 'POST':
        try:
            profile = UserProfile.objects.get(user=request.user)
            if profile.profile_image:
                profile.profile_image.delete()
                profile.profile_image = None
                profile.save()
        except UserProfile.DoesNotExist:
            pass
        return JsonResponse({
            'success': True,
            'message': t(lang, 'toast_photo_removed'),
        })
    return JsonResponse({
        'success': False,
        'message': t(lang, 'msg_acct_invalid_request'),
    }, status=400)
