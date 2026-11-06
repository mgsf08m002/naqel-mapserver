from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
import json

from config.api_errors import json_api_error
from config.ui_strings import t
from security.session_meta import stamp_session_metadata
from system_admin.password_admin import (
    create_password_reset_request,
    find_user_by_login_email,
    get_client_ip,
)


def _lang(request) -> str:
    return getattr(request, "ui_language", None) or "en"


def has_system_admin():
    """Check if a System Admin (superuser) already exists."""
    return User.objects.filter(is_superuser=True).exists()


def login_view(request):
    """Render the login page."""
    return render(request, 'auth/login.html')


def onetime_view(request):
    """Render the one-time system admin registration page."""
    # Redirect to login once a System Admin already exists.
    if has_system_admin():
        messages.info(request, t(_lang(request), "admin_already_exists"))
        return redirect("auth:login")

    return render(request, "auth/onetime.html")


@csrf_exempt
@require_http_methods(["POST"])
def check_login_email_api(request):
    """Validate that an email belongs to an existing account (login step 1)."""
    lang = _lang(request)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return json_api_error(
            request,
            status=400,
            message_key="invalid_server_response",
            log=False,
            extra={"exists": False},
        )

    email = (data.get("email") or "").strip()
    if not email:
        msg = t(lang, "email_required")
        return JsonResponse(
            {
                "success": False,
                "exists": False,
                "message": msg,
            },
            status=400,
        )

    user = find_user_by_login_email(email)
    if user is None:
        msg = t(lang, "no_account_email")
        return JsonResponse(
            {
                "success": False,
                "exists": False,
                "message": msg,
            },
            status=404,
        )

    if not user.is_active:
        msg = t(lang, "account_inactive")
        return JsonResponse(
            {
                "success": False,
                "exists": True,
                "active": False,
                "message": msg,
            },
            status=403,
        )

    return JsonResponse(
        {
            "success": True,
            "exists": True,
            "active": True,
        },
        status=200,
    )


@csrf_exempt
@require_http_methods(["POST"])
def login_api(request):
    """Handle login API request."""
    lang = _lang(request)
    try:
        data = json.loads(request.body)
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            msg = t(lang, "email_password_required")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)

        user_check = find_user_by_login_email(email)
        if user_check is not None and not user_check.is_active:
            if user_check.check_password(password):
                msg = t(lang, "account_inactive")
                return JsonResponse({
                    'success': False,
                    'message': msg
                }, status=403)

        # Authenticate against the resolved username (email login).
        auth_username = user_check.username if user_check is not None else email
        user = authenticate(request, username=auth_username, password=password)
        
        if user is not None:
            login(request, user)
            stamp_session_metadata(request, force=True)
            # First sign-in: personal password setup before entering the map.
            if (
                hasattr(user, "profile")
                and user.profile.role in ("manager", "editor")
                and not user.profile.password_setup_completed
            ):
                redirect_url = reverse("auth:password_setup")
            # Redirect based on user role
            elif user.is_superuser:
                redirect_url = reverse('system_admin:map')
            elif hasattr(user, 'profile') and user.profile.role:
                # Check permissions for managers and editors
                if user.profile.role == 'manager':
                    # Map is accessible without permissions, other pages require permissions
                    redirect_url = reverse('manager:map')
                elif user.profile.role == 'editor':
                    # Map is accessible without permissions, other pages require permissions
                    redirect_url = reverse('editor:map')
                else:
                    redirect_url = '/'
            else:
                redirect_url = '/'  # Regular users go to home page
            return JsonResponse({
                'success': True,
                'redirect_url': redirect_url,
            }, status=200)
        else:
            msg = t(lang, "invalid_credentials")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=401)
            
    except json.JSONDecodeError:
        return json_api_error(
            request,
            status=400,
            message_key="invalid_server_response",
            log=False,
        )
    except Exception as e:
        return json_api_error(request, exc=e, status=500, message_key="generic_error")


@csrf_exempt
@require_http_methods(["POST"])
def onetime_api(request):
    """Handle System Admin registration API request."""
    lang = _lang(request)
    # Reject attempts once a System Admin already exists.
    if has_system_admin():
        msg = t(lang, "admin_route_closed")
        return JsonResponse({
            'success': False,
            'message': msg
        }, status=403)
    
    try:
        data = json.loads(request.body)
        full_name = data.get('full_name')
        email = data.get('email')
        password = data.get('password')
        confirm_password = data.get('confirm_password')
        
        # Validation
        if not full_name:
            msg = t(lang, "full_name_required")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)
        if not email:
            msg = t(lang, "email_required")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)
        if not password:
            msg = t(lang, "password_required")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)
        if password != confirm_password:
            msg = t(lang, "passwords_mismatch")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)
        if len(password) < 8:
            msg = t(lang, "password_min")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)
        
        # Check if user already exists
        if User.objects.filter(username=email).exists():
            msg = t(lang, "user_exists")
            return JsonResponse({
                'success': False,
                'message': msg
            }, status=400)
        
        # Create System Admin user
        user = User.objects.create_user(
            username=email,
            email=email,
            password=password,
            first_name=full_name.split()[0] if full_name.split() else '',
            last_name=' '.join(full_name.split()[1:]) if len(full_name.split()) > 1 else '',
            is_staff=True,
            is_superuser=True
        )
        
        # Create user profile with account creation date and time
        from system_admin.models import UserProfile
        profile = UserProfile.objects.create(user=user)
        profile.set_account_creation_datetime()
        
        msg = t(lang, "admin_created")
        return JsonResponse({
            'success': True,
            'message': msg
        }, status=200)
            
    except json.JSONDecodeError:
        return json_api_error(
            request,
            status=400,
            message_key="invalid_server_response",
            log=False,
        )
    except Exception as e:
        return json_api_error(
            request, exc=e, status=500, message_key="registration_failed"
        )


_FORGOT_PASSWORD_ERROR_KEYS = {
    "inactive": "forgot_inactive",
    "not_eligible": "forgot_not_eligible",
    "pending": "forgot_pending",
    "cooldown": "forgot_cooldown",
}


def forgot_password_view(request):
    """Public forgot-password request form (admin-mediated reset)."""
    lang = _lang(request)
    context = {
        "email": "",
        "form_error": "",
        "request_submitted": False,
    }

    if request.method != "POST":
        return render(request, "auth/forgot_password.html", context)

    email = (request.POST.get("email") or "").strip()
    context["email"] = email
    if not email:
        context["form_error"] = t(lang, "forgot_email_required")
        return render(request, "auth/forgot_password.html", context)

    user = find_user_by_login_email(email)
    if user is None:
        context["form_error"] = t(lang, "forgot_no_account")
        return render(request, "auth/forgot_password.html", context)

    req, error_code = create_password_reset_request(
        user=user,
        requester_ip=get_client_ip(request),
    )
    if error_code:
        context["form_error"] = t(
            lang,
            _FORGOT_PASSWORD_ERROR_KEYS.get(error_code, "forgot_unable"),
        )
    elif req is not None:
        context["request_submitted"] = True
        messages.success(request, t(lang, "forgot_success_toast"))
    else:
        context["form_error"] = t(lang, "forgot_unable")

    return render(request, "auth/forgot_password.html", context)


def _map_redirect_for_role(role: str):
    if role == "manager":
        return redirect("manager:map")
    if role == "editor":
        return redirect("editor:map")
    return redirect("auth:login")


@login_required
def password_setup_view(request):
    """First-sign-in personal password setup for manager/editor accounts."""
    lang = _lang(request)

    if not hasattr(request.user, "profile") or not request.user.profile.role:
        messages.error(request, t(lang, "setup_sign_in_required"))
        return redirect("auth:login")

    role = request.user.profile.role
    if role not in ("manager", "editor"):
        messages.error(request, t(lang, "setup_role_only"))
        return redirect("auth:login")

    if request.user.profile.password_setup_completed:
        return _map_redirect_for_role(role)

    context = {
        "setup_welcome": t(lang, "setup_welcome", role=t(lang, f"role_{role}")),
    }

    if request.method == "POST":
        intent = request.POST.get("intent")
        if intent == "skip_password_setup":
            request.user.profile.password_setup_completed = True
            request.user.profile.save()
            messages.info(request, t(lang, "setup_skip_toast"))
            return _map_redirect_for_role(role)

        if intent == "set_password":
            errors = []
            new_password = request.POST.get("new_password", "").strip()
            confirm_password = request.POST.get("confirm_password", "").strip()

            if not new_password:
                errors.append(t(lang, "password_required"))
            elif len(new_password) < 8:
                errors.append(t(lang, "password_min"))

            if new_password != confirm_password:
                errors.append(t(lang, "passwords_mismatch"))

            if errors:
                for err in errors:
                    messages.error(request, err)
            else:
                request.user.set_password(new_password)
                request.user.save()
                request.user.profile.password_setup_completed = True
                request.user.profile.save()
                login(request, request.user)
                stamp_session_metadata(request, force=True)
                messages.success(request, t(lang, "setup_saved_toast"))
                return _map_redirect_for_role(role)

    return render(request, "auth/password_setup.html", context)


@login_required
def logout_view(request):
    """Handle logout and drop the matching UserSession enrichment row."""
    from security.session_meta import delete_user_session_record

    session_key = request.session.session_key
    logout(request)
    delete_user_session_record(session_key)
    return redirect(f"{reverse('auth:login')}?signed_out=1")
