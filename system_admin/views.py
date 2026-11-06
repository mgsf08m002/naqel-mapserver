from datetime import datetime
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout
from django.urls import reverse
from django.contrib.auth.models import User
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.db.models import F
from django.utils.html import format_html
from config.api_errors import json_api_error
from config.riyadh_time import (
    start_of_previous_riyadh_month,
    start_of_riyadh_month,
    to_riyadh,
)
from config.ui_strings import t
from .account import (
    remove_profile_image,
    render_account_page,
    upload_profile_image,
)
from .security_page import render_security_page
from .models import PasswordChangeEvent, PasswordResetRequest, UserProfile
from .password_admin import (
    apply_admin_temporary_password,
    dismiss_password_reset_request,
    find_user_by_login_email,
    password_changes_this_month_count,
    pending_request_count,
    validate_temporary_password,
)
from mapping.presentation import enforce_my_edits_access, my_edits_page_context


_MONTHS_EN_SHORT = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
_MONTHS_EN_FULL = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
_MONTHS_AR = (
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
)


def _ui_lang(request) -> str:
    return getattr(request, "ui_language", None) or "en"


def _format_users_date(value, lang: str, *, full: bool = False) -> str | None:
    """Localized calendar date for Users UI (Asia/Riyadh wall clock)."""
    value = to_riyadh(value)
    if value is None:
        return None
    day = value.day
    month_index = value.month - 1
    year = value.year
    if lang == "ar":
        return f"{day} {_MONTHS_AR[month_index]} {year}"
    months = _MONTHS_EN_FULL if full else _MONTHS_EN_SHORT
    return f"{months[month_index]} {day}, {year}"


def _format_users_time(value, lang: str) -> str | None:
    """Localized clock time for Users UI (Asia/Riyadh wall clock)."""
    value = to_riyadh(value)
    if value is None:
        return None
    hour = value.hour
    minute = value.minute
    hour12 = hour % 12 or 12
    if lang == "ar":
        suffix = "ص" if hour < 12 else "م"
        return f"{hour12}:{minute:02d} {suffix}"
    suffix = "AM" if hour < 12 else "PM"
    return f"{hour12}:{minute:02d} {suffix}"


def _format_users_datetime(value, lang: str) -> str | None:
    """Localized date + time for Users UI (Asia/Riyadh)."""
    if value is None:
        return None
    return (
        f"{_format_users_date(value, lang)} "
        f"{t(lang, 'date_at')} "
        f"{_format_users_time(value, lang)}"
    )


def _users_account_created_display(profile, lang: str) -> str | None:
    if not profile or not profile.account_creation_date:
        return None
    date_part = _format_users_date(profile.account_creation_date, lang)
    if not profile.account_creation_time:
        return date_part
    return (
        f"{date_part} {t(lang, 'date_at')} "
        f"{_format_users_time(profile.account_creation_time, lang)}"
    )


def _attach_users_meta_displays(context, user, profile, lang: str) -> None:
    context["account_created_display"] = _users_account_created_display(profile, lang)
    context["last_login_display"] = _format_users_datetime(user.last_login, lang)


def _password_role_label(role: str | None, lang: str) -> str:
    if role == "manager":
        return t(lang, "role_manager")
    if role == "editor":
        return t(lang, "role_editor")
    return t(lang, "not_assigned")


def _manageable_user(user_id, action_label, lang="en"):
    """Return a non-admin user and profile, or an error message."""
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, TypeError, ValueError):
        return None, None, t(lang, "msg_users_not_found")
    if user.is_superuser:
        if action_label in ("edited", "edit"):
            return None, None, t(lang, "msg_users_admin_cannot_edit_page")
        if action_label in ("deleted", "delete"):
            return None, None, t(lang, "msg_users_admin_cannot_delete_page")
        return None, None, t(lang, "msg_users_admin_cannot_reset_page")
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return user, profile, None


def _require_superuser(request):
    """Return None when allowed, otherwise a redirect response."""
    if request.user.is_superuser:
        return None
    logout(request)
    return redirect(f"{reverse('auth:login')}?session_ended=1")


@login_required(login_url='/login/')
def map_view(request):
    """System Admin Map view - landing page after login."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, "system_admin/map.html")


@login_required(login_url='/login/')
def account_information_view(request):
    """Account Information view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render_account_page(request, 'admin', 'system_admin/account_information.html')


@login_required(login_url='/login/')
def security_view(request):
    """Security view."""
    # Only superusers (system admins) can access this view.
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render_security_page(request, "admin", "system_admin/security.html")


def _users_stat_trend(delta: int, lang: str) -> dict:
    """Month-over-month trend label for Users dashboard stat cards."""
    if delta > 0:
        return {"direction": "up", "label": f"+{delta}"}
    if delta < 0:
        return {"direction": "down", "label": str(delta)}
    return {"direction": "flat", "label": t(lang, "no_change")}


@login_required(login_url='/login/')
def users_view(request):
    """Users view."""
    # Only superusers (system admins) can access this view.
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    # High-level user statistics.
    all_users_count = User.objects.count()
    active_users_count = User.objects.filter(is_active=True).count()

    # Calendar month bounds in Asia/Riyadh (not UTC).
    start_of_month = start_of_riyadh_month()
    start_of_prev_month = start_of_previous_riyadh_month()

    users_this_month = User.objects.filter(date_joined__gte=start_of_month).count()
    users_last_month = User.objects.filter(
        date_joined__gte=start_of_prev_month,
        date_joined__lt=start_of_month,
    ).count()
    active_joined_this_month = User.objects.filter(
        is_active=True,
        date_joined__gte=start_of_month,
    ).count()
    active_joined_last_month = User.objects.filter(
        is_active=True,
        date_joined__gte=start_of_prev_month,
        date_joined__lt=start_of_month,
    ).count()

    lang = _ui_lang(request)

    # Trends compare this calendar month vs the previous month.
    joined_trend = _users_stat_trend(users_this_month - users_last_month, lang)
    all_users_trend = joined_trend
    users_this_month_trend = joined_trend
    active_users_trend = _users_stat_trend(
        active_joined_this_month - active_joined_last_month, lang
    )

    def _display_role(user):
        if user.is_superuser:
            return t(lang, "role_system_admin")
        profile = getattr(user, "profile", None)
        if profile and profile.role == "editor":
            return t(lang, "role_editor")
        if profile and profile.role == "manager":
            return t(lang, "role_manager")
        return t(lang, "role_viewer")

    recent_users = []
    recent_qs = (
        User.objects.select_related('profile')
        .order_by(F('last_login').desc(nulls_last=True), '-date_joined')[:50]
    )
    for user in recent_qs:
        profile = getattr(user, 'profile', None)
        full_name = user.get_full_name() or user.username
        recent_users.append({
            'id': user.id,
            'full_name': full_name,
            'email': user.email,
            'role': _display_role(user),
            'is_active': user.is_active,
            'is_superuser': user.is_superuser,
            'last_login_display': _format_users_datetime(user.last_login, lang),
            'initial': (full_name or user.email or '?')[:1].upper(),
            'profile_image': profile.profile_image.url if profile and profile.profile_image else '',
        })

    context = {
        'all_users_count': all_users_count,
        'active_users_count': active_users_count,
        'users_this_month': users_this_month,
        'all_users_trend': all_users_trend,
        'active_users_trend': active_users_trend,
        'users_this_month_trend': users_this_month_trend,
        'recent_users': recent_users,
    }

    return render(request, 'system_admin/users.html', context)


@login_required(login_url='/login/')
def add_user_view(request):
    """Add User view."""
    # Only superusers (system admins) can create new users.
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    context = {}
    lang = _ui_lang(request)

    if request.method == 'POST':
        intent = request.POST.get('intent')
        if intent == 'add_user':
            errors = []
            full_name = request.POST.get('full_name', '').strip()
            email = request.POST.get('email', '').strip()
            password = request.POST.get('password', '').strip()
            confirm_password = request.POST.get('confirm_password', '').strip()
            role = request.POST.get('role', '').strip()
            
            if not full_name:
                errors.append(t(lang, 'full_name_required'))
            
            if not email:
                errors.append(t(lang, 'email_required'))
            else:
                try:
                    validate_email(email)
                except ValidationError:
                    errors.append(t(lang, 'email_invalid'))
                else:
                    if User.objects.filter(username=email).exists():
                        errors.append(t(lang, 'user_exists'))
            
            if not password:
                errors.append(t(lang, 'password_required'))
            elif len(password) < 8:
                errors.append(t(lang, 'password_min'))
            
            if password != confirm_password:
                errors.append(t(lang, 'passwords_mismatch'))
            
            if not role:
                errors.append(t(lang, 'add_user_select_role'))
            elif role not in ['manager', 'editor']:
                errors.append(t(lang, 'add_user_select_role'))
            
            if not errors:
                if role == 'manager':
                    can_access_dashboard = request.POST.get('can_access_dashboard') == 'on'
                    can_access_security = request.POST.get('can_access_security') == 'on'
                    can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                    can_access_layer_uploader = request.POST.get('can_access_layer_uploader') == 'on'
                    can_access_my_edits = request.POST.get('can_access_my_edits') == 'on'
                else:
                    # Editors never receive dashboard access.
                    can_access_dashboard = False
                    can_access_security = request.POST.get('can_access_security') == 'on'
                    can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                    can_access_layer_uploader = request.POST.get('can_access_layer_uploader') == 'on'
                    can_access_my_edits = request.POST.get('can_access_my_edits') == 'on'

                # Create the base Django user.
                user = User.objects.create_user(
                    username=email,
                    email=email,
                    password=password,
                    first_name=full_name.split()[0] if full_name.split() else '',
                    last_name=' '.join(full_name.split()[1:]) if len(full_name.split()) > 1 else '',
                    is_active=True
                )
                
                # Attach a profile capturing role, permissions, and creation timestamp.
                profile = UserProfile.objects.create(
                    user=user,
                    role=role,
                    can_access_dashboard=can_access_dashboard,
                    can_access_security=can_access_security,
                    can_access_account_information=can_access_account_information,
                    can_access_layer_uploader=can_access_layer_uploader,
                    can_access_my_edits=can_access_my_edits,
                )
                profile.set_account_creation_datetime()
                
                messages.success(
                    request,
                    t(
                        lang,
                        'msg_users_added_as',
                        role=t(lang, 'role_manager' if role == 'manager' else 'role_editor'),
                    ),
                )
            else:
                for err in errors:
                    messages.error(request, err)
    
    return render(request, 'system_admin/add_user.html', context)


@login_required(login_url='/login/')
def edit_user_view(request, user_id=None):
    """Edit User view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    lang = _ui_lang(request)
    context = {}

    if request.method != 'POST':
        if user_id:
            user_to_edit, profile, error = _manageable_user(user_id, 'edited', lang)
            if error:
                messages.warning(request, error)
            else:
                context['user_to_edit'] = user_to_edit
                context['user_profile'] = profile
                _attach_users_meta_displays(context, user_to_edit, profile, lang)
        return render(request, 'system_admin/edit_user.html', context)

    intent = request.POST.get('intent')

    if intent == 'search_user':
        email = request.POST.get('search_email', '').strip()
        if not email:
            messages.error(request, t(lang, 'msg_users_search_email_required'))
            return render(request, 'system_admin/edit_user.html', context)

        try:
            user_to_edit = User.objects.get(username=email)
        except User.DoesNotExist:
            messages.error(request, t(lang, 'msg_users_not_found_email'))
            return render(request, 'system_admin/edit_user.html', context)

        if user_to_edit.is_superuser:
            messages.warning(
                request,
                t(lang, 'msg_users_admin_cannot_edit_page'),
            )
            return render(request, 'system_admin/edit_user.html', context)

        profile, _ = UserProfile.objects.get_or_create(user=user_to_edit)
        context['user_to_edit'] = user_to_edit
        context['user_profile'] = profile
        _attach_users_meta_displays(context, user_to_edit, profile, lang)

    elif intent == 'update_user':
        user_id = request.POST.get('user_id')
        if not user_id:
            messages.error(request, t(lang, 'msg_users_id_required'))
            return render(request, 'system_admin/edit_user.html', context)

        try:
            user_to_edit = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            messages.error(request, t(lang, 'msg_users_not_found'))
            return render(request, 'system_admin/edit_user.html', context)

        if user_to_edit.is_superuser:
            messages.error(request, t(lang, 'msg_users_admin_cannot_edit'))
            return render(request, 'system_admin/edit_user.html', context)

        errors = []
        full_name = request.POST.get('full_name', '').strip()
        email = request.POST.get('email', '').strip()
        account_status = request.POST.get('account_status', '').strip()

        if not full_name:
            errors.append(t(lang, 'full_name_required'))

        if not email:
            errors.append(t(lang, 'email_required'))
        else:
            try:
                validate_email(email)
            except ValidationError:
                errors.append(t(lang, 'email_invalid'))
            else:
                if User.objects.filter(username=email).exclude(pk=user_to_edit.pk).exists():
                    errors.append(t(lang, 'user_exists'))

        if account_status not in ['active', 'inactive']:
            errors.append(t(lang, 'msg_users_invalid_status'))

        if not errors:
            name_parts = full_name.split()
            user_to_edit.first_name = name_parts[0] if name_parts else ''
            user_to_edit.last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
            user_to_edit.email = email
            user_to_edit.username = email
            user_to_edit.is_active = account_status == 'active'
            user_to_edit.save()
            messages.success(request, t(lang, 'msg_users_updated'))
        else:
            for err in errors:
                messages.error(request, err)

        profile, _ = UserProfile.objects.get_or_create(user=user_to_edit)
        context['user_to_edit'] = user_to_edit
        context['user_profile'] = profile
        _attach_users_meta_displays(context, user_to_edit, profile, lang)

    return render(request, 'system_admin/edit_user.html', context)


@login_required(login_url='/login/')
def delete_user_view(request, user_id=None):
    """Delete User view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    lang = _ui_lang(request)
    context = {}

    if request.method != 'POST':
        if user_id:
            user_to_delete, profile, error = _manageable_user(user_id, 'deleted', lang)
            if error:
                messages.warning(request, error)
            else:
                context['user_to_delete'] = user_to_delete
                context['user_profile'] = profile
                _attach_users_meta_displays(context, user_to_delete, profile, lang)
        return render(request, 'system_admin/delete_user.html', context)

    intent = request.POST.get('intent')

    if intent == 'search_user':
        email = request.POST.get('search_email', '').strip()
        if not email:
            messages.error(request, t(lang, 'msg_users_search_email_required'))
        else:
            try:
                user_to_delete = User.objects.get(username=email)
            except User.DoesNotExist:
                messages.error(request, t(lang, 'msg_users_not_found_email'))
            else:
                if user_to_delete.is_superuser:
                    messages.warning(
                        request,
                        t(lang, 'msg_users_admin_cannot_delete_page'),
                    )
                else:
                    profile, _ = UserProfile.objects.get_or_create(user=user_to_delete)
                    context['user_to_delete'] = user_to_delete
                    context['user_profile'] = profile
                    _attach_users_meta_displays(context, user_to_delete, profile, lang)

    elif intent == 'delete_user':
        posted_user_id = request.POST.get('user_id')
        if not posted_user_id:
            messages.error(request, t(lang, 'msg_users_id_required'))
        else:
            try:
                user_to_delete = User.objects.get(pk=posted_user_id)
            except User.DoesNotExist:
                messages.error(request, t(lang, 'msg_users_not_found'))
            else:
                if user_to_delete.is_superuser:
                    messages.error(request, t(lang, 'msg_users_admin_cannot_delete'))
                else:
                    user_to_delete.delete()
                    messages.success(request, t(lang, 'msg_users_deleted'))

    return render(request, 'system_admin/delete_user.html', context)


@login_required(login_url='/login/')
def manage_passwords_view(request):
    """Manage Passwords hub."""
    if denied := _require_superuser(request):
        return denied

    return render(request, 'system_admin/manage_passwords.html', {
        'pending_requests': pending_request_count(),
        'password_changes_this_month': password_changes_this_month_count(),
    })


@login_required(login_url='/login/')
def change_user_password_view(request):
    """System Admin: search a user and set a temporary password directly."""
    if denied := _require_superuser(request):
        return denied

    lang = _ui_lang(request)
    context = {
        'user_to_change': None,
        'user_profile': None,
        'password_set': False,
        'temporary_password': '',
    }

    if request.method == 'POST':
        intent = request.POST.get('intent')

        if intent == 'search_user':
            email = request.POST.get('search_email', '').strip()
            if not email:
                messages.error(request, t(lang, 'msg_users_search_email_required'))
            else:
                user = find_user_by_login_email(email)
                if user is None:
                    messages.error(request, t(lang, 'msg_users_not_found_email'))
                elif user.is_superuser:
                    messages.error(
                        request,
                        t(lang, 'msg_users_admin_cannot_reset_page'),
                    )
                else:
                    profile, _ = UserProfile.objects.get_or_create(user=user)
                    if profile.role not in ('manager', 'editor'):
                        messages.error(
                            request,
                            t(lang, 'msg_pwd_only_manager_editor'),
                        )
                    else:
                        context['user_to_change'] = user
                        context['user_profile'] = profile

        elif intent == 'set_password':
            user, profile, err = _manageable_user(
                request.POST.get('user_id'),
                'password-reset',
                lang,
            )
            if err:
                messages.error(request, err)
            elif profile.role not in ('manager', 'editor'):
                messages.error(
                    request,
                    t(lang, 'msg_pwd_only_manager_editor'),
                )
                context['user_to_change'] = user
                context['user_profile'] = profile
            else:
                context['user_to_change'] = user
                context['user_profile'] = profile
                new_password = request.POST.get('new_password', '').strip()
                confirm_password = request.POST.get('confirm_password', '').strip()
                errors = validate_temporary_password(new_password, confirm_password, lang)
                if errors:
                    for err_msg in errors:
                        messages.error(request, err_msg)
                else:
                    apply_admin_temporary_password(
                        target=user,
                        new_password=new_password,
                        changed_by=request.user,
                        source=PasswordChangeEvent.Source.ADMIN_DIRECT,
                        lang=lang,
                    )
                    context['password_set'] = True
                    context['temporary_password'] = new_password
                    messages.success(
                        request,
                        t(lang, 'msg_pwd_temp_set'),
                    )

    if context.get('user_to_change') and context.get('user_profile'):
        context['role_display'] = _password_role_label(
            context['user_profile'].role, lang
        )
        if context.get('password_set'):
            display_name = (
                context['user_to_change'].get_full_name()
                or context['user_to_change'].username
            )
            context['pwd_success_copy'] = t(
                lang, 'pwd_success_copy', name=display_name
            )

    return render(request, 'system_admin/change_password.html', context)


@login_required(login_url='/login/')
def password_requests_view(request):
    """System Admin: review and fulfill forgot-password requests."""
    if denied := _require_superuser(request):
        return denied

    lang = _ui_lang(request)
    context = {
        'reset_success': None,
        'temporary_password': '',
        'active_request_id': None,
    }

    if request.method == 'POST':
        intent = request.POST.get('intent')
        try:
            reset_req = PasswordResetRequest.objects.select_related(
                'user', 'user__profile'
            ).get(pk=request.POST.get('request_id'))
        except (PasswordResetRequest.DoesNotExist, TypeError, ValueError):
            messages.error(request, t(lang, 'msg_pwd_request_not_found'))
            reset_req = None

        if reset_req is not None and reset_req.status != PasswordResetRequest.Status.PENDING:
            messages.error(request, t(lang, 'msg_pwd_request_not_pending'))
            reset_req = None

        if reset_req is not None and intent == 'dismiss_request':
            dismiss_password_reset_request(
                request=reset_req,
                dismissed_by=request.user,
                admin_note=request.POST.get('admin_note', '').strip(),
                lang=lang,
            )
            messages.success(request, t(lang, 'msg_pwd_request_dismissed'))

        elif reset_req is not None and intent == 'reset_password':
            new_password = request.POST.get('new_password', '').strip()
            confirm_password = request.POST.get('confirm_password', '').strip()
            errors = validate_temporary_password(new_password, confirm_password, lang)
            if errors:
                for err_msg in errors:
                    messages.error(request, err_msg)
                context['active_request_id'] = reset_req.pk
            else:
                apply_admin_temporary_password(
                    target=reset_req.user,
                    new_password=new_password,
                    changed_by=request.user,
                    source=PasswordChangeEvent.Source.FORGOT_REQUEST,
                    request=reset_req,
                    admin_note=request.POST.get('admin_note', '').strip(),
                    lang=lang,
                )
                context['reset_success'] = reset_req.user
                context['temporary_password'] = new_password
                messages.success(
                    request,
                    t(lang, 'msg_pwd_reset_done'),
                )

    pending_qs = (
        PasswordResetRequest.objects.filter(status=PasswordResetRequest.Status.PENDING)
        .select_related('user', 'user__profile')
        .order_by('-requested_at')
    )
    pending_rows = []
    for item in pending_qs:
        role = getattr(getattr(item.user, 'profile', None), 'role', None)
        item.role_display = _password_role_label(role, lang)
        item.requested_display = _format_users_datetime(item.requested_at, lang) or '-'
        pending_rows.append(item)

    context['pending_requests'] = pending_rows
    context['pending_title'] = t(
        lang, 'pwd_req_pending_title', count=len(pending_rows)
    )
    if context.get('reset_success'):
        display_name = (
            context['reset_success'].get_full_name()
            or context['reset_success'].username
        )
        context['pwd_resolved_copy'] = t(
            lang, 'pwd_req_resolved_copy', name=display_name
        )
    return render(request, 'system_admin/password_requests.html', context)


@login_required(login_url='/login/')
def upload_profile_image_view(request):
    """Handle profile image upload."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
        }, status=403)
    return upload_profile_image(request)


@login_required(login_url='/login/')
def remove_profile_image_view(request):
    """Handle profile image removal."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
        }, status=403)
    return remove_profile_image(request)


@login_required(login_url='/login/')
def all_users_view(request):
    """All Users view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, 'system_admin/all_users.html')


@login_required(login_url='/login/')
def view_user_view(request, user_id):
    """View User detail view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, 'system_admin/view_user.html', {'user_id': user_id})


@login_required(login_url='/login/')
def users_api_view(request):
    """API endpoint to fetch all users."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
            'users': []
        }, status=403)
    
    lang = _ui_lang(request)
    try:
        users = User.objects.all().select_related('profile').order_by('-date_joined')
        users_data = []

        for user in users:
            profile = getattr(user, 'profile', None)
            full_name = user.get_full_name() or (user.first_name + ' ' + user.last_name).strip() or None

            if user.is_superuser:
                role = 'system_admin'
            elif profile and profile.role:
                role = profile.role
            else:
                role = None

            created_source = None
            if profile and profile.account_creation_date:
                created_time = profile.account_creation_time or datetime.min.time()
                created_source = datetime.combine(profile.account_creation_date, created_time)
            elif user.date_joined:
                created_source = user.date_joined

            profile_image = None
            if profile and profile.profile_image:
                profile_image = profile.profile_image.url

            users_data.append({
                'id': user.id,
                'email': user.email,
                'full_name': full_name,
                'is_active': user.is_active,
                'is_superuser': user.is_superuser,
                'role': role,
                'profile_image': profile_image,
                'created_display': _format_users_datetime(created_source, lang),
                'last_login_display': _format_users_datetime(user.last_login, lang),
            })

        return JsonResponse({
            'success': True,
            'users': users_data
        })
    except Exception as e:
        return json_api_error(
            request,
            exc=e,
            status=500,
            message_key="toast_couldnt_load",
            extra={"users": []},
        )


@login_required(login_url='/login/')
def user_detail_api_view(request, user_id):
    """API endpoint to fetch a single user's details."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
            'user': None
        }, status=403)
    
    lang = _ui_lang(request)
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
        profile = getattr(user, 'profile', None)
        full_name = user.get_full_name() or (user.first_name + ' ' + user.last_name).strip() or None

        role = None
        if user.is_superuser:
            role = 'system_admin'
        elif profile and profile.role:
            role = profile.role

        account_creation_date = None
        account_creation_time = None
        if profile and profile.account_creation_date:
            account_creation_date = _format_users_date(
                profile.account_creation_date, lang, full=True
            )
            if profile.account_creation_time:
                account_creation_time = _format_users_time(
                    profile.account_creation_time, lang
                )

        profile_image = None
        if profile and profile.profile_image:
            profile_image = profile.profile_image.url

        user_data = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'full_name': full_name,
            'is_active': user.is_active,
            'is_superuser': user.is_superuser,
            'role': role,
            'profile_image': profile_image,
            'account_creation_date': account_creation_date,
            'account_creation_time': account_creation_time,
        }
        
        return JsonResponse({
            'success': True,
            'user': user_data
        })
    except User.DoesNotExist:
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'msg_users_not_found'),
            'user': None
        }, status=404)
    except Exception as e:
        return json_api_error(
            request,
            exc=e,
            status=500,
            message_key="toast_couldnt_load",
            extra={"user": None},
        )


def _permission_subject(user_id, lang: str):
    """Return a manager/editor and profile, or an error message."""
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
    except User.DoesNotExist:
        return None, None, None, t(lang, 'msg_perm_user_not_found')

    profile, _ = UserProfile.objects.get_or_create(user=user)
    role = 'system_admin' if user.is_superuser else profile.role
    if role not in ('manager', 'editor'):
        return None, None, None, t(lang, 'msg_perm_role_only')
    return user, profile, role, None


def _save_permission_flags(profile, role, post_data):
    if role == 'manager':
        profile.can_access_dashboard = post_data.get('can_access_dashboard') == 'on'
    else:
        profile.can_access_dashboard = False
    profile.can_access_security = post_data.get('can_access_security') == 'on'
    profile.can_access_account_information = post_data.get('can_access_account_information') == 'on'
    profile.can_access_layer_uploader = post_data.get('can_access_layer_uploader') == 'on'
    profile.can_access_my_edits = post_data.get('can_access_my_edits') == 'on'
    profile.save()


def _has_any_permission(profile, role):
    flags = [
        profile.can_access_security,
        profile.can_access_account_information,
        profile.can_access_layer_uploader,
        profile.can_access_my_edits,
    ]
    if role == 'manager':
        flags.append(profile.can_access_dashboard)
    return any(flags)


def _perm_role_word(role: str, lang: str) -> str:
    """Role word for copy: English keeps lowercase role keys; Arabic uses labels."""
    if lang == 'ar':
        return _password_role_label(role, lang)
    return role


def _perm_subtitle_html(lang: str, key: str, name: str):
    template = t(lang, key)
    if '{name}' not in template:
        return t(lang, key, name=name)
    before, after = template.split('{name}', 1)
    return format_html('{}<strong>{}</strong>{}', before, name, after)


def _permissions_form_view(request, user_id, template_name, *, mode: str):
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    lang = _ui_lang(request)
    target_user, profile, role, error = _permission_subject(user_id, lang)
    if error:
        if error == t(lang, 'msg_perm_user_not_found'):
            messages.error(request, error)
        else:
            messages.warning(request, error)
        return redirect('system_admin:permissions')

    display_name = target_user.get_full_name() or target_user.email
    if request.method == 'POST':
        _save_permission_flags(profile, role, request.POST)
        success_key = 'msg_perm_granted' if mode == 'grant' else 'msg_perm_updated'
        messages.success(request, t(lang, success_key, name=display_name))
        return redirect('system_admin:permissions')

    role_word = _perm_role_word(role, lang)
    role_label = _password_role_label(role, lang)
    subtitle_key = 'perm_grant_subtitle' if mode == 'grant' else 'perm_check_subtitle'
    role_desc_key = 'perm_role_grant_desc' if mode == 'grant' else 'perm_role_check_desc'

    return render(request, template_name, {
        'target_user': target_user,
        'profile': profile,
        'role': role,
        'page_subtitle': _perm_subtitle_html(lang, subtitle_key, display_name),
        'role_heading': t(lang, 'perm_role_heading', role=role_label),
        'role_desc': t(lang, role_desc_key, role=role_word),
        'security_desc': t(lang, 'perm_security_desc', role=role_word),
        'account_desc': t(lang, 'perm_account_desc', role=role_word),
        'uploader_desc': t(lang, 'perm_uploader_desc', role=role_word),
        'edits_desc': t(lang, 'perm_edits_desc', role=role_word),
    })


@login_required(login_url='/login/')
def permissions_view(request):
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, 'system_admin/permissions.html')


@login_required(login_url='/login/')
def grant_permission_view(request, user_id):
    return _permissions_form_view(
        request,
        user_id,
        'system_admin/grant_permission.html',
        mode='grant',
    )


@login_required(login_url='/login/')
def check_permission_view(request, user_id):
    return _permissions_form_view(
        request,
        user_id,
        'system_admin/check_permission.html',
        mode='check',
    )


@login_required(login_url='/login/')
def permissions_api_view(request):
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': t(_ui_lang(request), 'toast_couldnt_load'),
            'users': [],
        }, status=403)

    try:
        users_data = []
        users = User.objects.select_related('profile').order_by('-date_joined')
        for user in users:
            if user.is_superuser:
                continue
            profile = getattr(user, 'profile', None)
            role = profile.role if profile else None
            if role not in ('manager', 'editor'):
                continue
            full_name = user.get_full_name() or (user.first_name + ' ' + user.last_name).strip() or None
            users_data.append({
                'id': user.id,
                'email': user.email,
                'full_name': full_name,
                'role': role,
                'has_permissions': _has_any_permission(profile, role),
            })
        return JsonResponse({'success': True, 'users': users_data})
    except Exception as e:
        return json_api_error(
            request,
            exc=e,
            status=500,
            message_key="toast_couldnt_load",
            extra={"users": []},
        )


@login_required(login_url='/login/')
def my_edits_view(request):
    """My Edits history for system administrators."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    denied = enforce_my_edits_access(request)
    if denied:
        return denied

    context = my_edits_page_context(request.user)
    return render(request, "system_admin/my_edits.html", context)