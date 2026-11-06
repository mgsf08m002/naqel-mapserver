"""Shared Security page render + self-service password change."""

from django.contrib import messages
from django.contrib.auth import logout
from django.shortcuts import redirect, render

from config.ui_strings import t

from .models import PasswordChangeEvent
from .password_admin import flush_user_sessions


_AUDIENCE_SUBTITLE_KEY = {
    "admin": "sec_subtitle_admin",
    "manager": "sec_subtitle_manager",
    "editor": "sec_subtitle_editor",
}


def _ui_lang(request) -> str:
    return getattr(request, "ui_language", None) or "en"


def _change_own_password(request, lang: str):
    """
    Apply a self-service password change for the current user.

    On success returns a redirect response. On validation failure, pushes
    error messages and returns None so the page can re-render.
    """
    current_password = request.POST.get("current_password", "").strip()
    new_password = request.POST.get("new_password", "").strip()
    confirm_password = request.POST.get("confirm_password", "").strip()

    errors = []
    if not current_password or not new_password or not confirm_password:
        errors.append(t(lang, "msg_sec_fields_required"))
    if current_password and not request.user.check_password(current_password):
        errors.append(t(lang, "msg_sec_current_incorrect"))
    if new_password and len(new_password) < 8:
        errors.append(t(lang, "msg_sec_password_short"))
    if new_password and confirm_password and new_password != confirm_password:
        errors.append(t(lang, "msg_sec_password_mismatch"))

    if errors:
        for err in errors:
            messages.error(request, err)
        return None

    user = request.user
    user.set_password(new_password)
    user.save()
    PasswordChangeEvent.objects.create(
        user=user,
        changed_by=user,
        source=PasswordChangeEvent.Source.SELF_SECURITY,
    )
    flush_user_sessions(user)
    logout(request)
    return redirect("/login/?password_changed=1")


def render_security_page(request, audience: str, template_name: str):
    """Render the shared Security page for admin / manager / editor."""
    lang = _ui_lang(request)
    context = {
        "security_subtitle": t(lang, _AUDIENCE_SUBTITLE_KEY[audience]),
    }

    if request.method == "POST" and request.POST.get("intent") == "change_password":
        response = _change_own_password(request, lang)
        if response is not None:
            return response

    return render(request, template_name, context)
