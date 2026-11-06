"""Shared helpers for System Admin password resets and forgot-password requests."""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from config.riyadh_time import start_of_next_riyadh_month, start_of_riyadh_month
from config.ui_strings import t
from .models import PasswordChangeEvent, PasswordResetRequest, UserProfile

REQUEST_COOLDOWN = timedelta(hours=24)
MIN_PASSWORD_LENGTH = 8


def get_client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


def find_user_by_login_email(email: str) -> User | None:
    """Resolve a user by login email (username first, then email field)."""
    email = (email or "").strip()
    if not email:
        return None
    user = User.objects.filter(username__iexact=email).first()
    if user is not None:
        return user
    return User.objects.filter(email__iexact=email).first()


def is_password_reset_eligible(user: User) -> tuple[bool, str]:
    """Return (ok, reason_code) for public forgot-password eligibility."""
    if user.is_superuser:
        return False, "not_eligible"
    if not user.is_active:
        return False, "inactive"
    profile = getattr(user, "profile", None)
    if profile is None or profile.role not in ("manager", "editor"):
        return False, "not_eligible"
    return True, ""


def pending_request_for(user: User) -> PasswordResetRequest | None:
    return (
        PasswordResetRequest.objects.filter(user=user, status=PasswordResetRequest.Status.PENDING)
        .order_by("-requested_at")
        .first()
    )


def recent_closed_request(user: User) -> PasswordResetRequest | None:
    cutoff = timezone.now() - REQUEST_COOLDOWN
    return (
        PasswordResetRequest.objects.filter(
            user=user,
            status__in=[
                PasswordResetRequest.Status.RESOLVED,
                PasswordResetRequest.Status.DISMISSED,
            ],
            resolved_at__gte=cutoff,
        )
        .order_by("-resolved_at")
        .first()
    )


def create_password_reset_request(*, user: User, requester_ip: str | None = None) -> tuple[PasswordResetRequest | None, str]:
    """
    Create a pending forgot-password request.

    Returns (request, error_code). error_code is empty on success.
    Codes: pending, cooldown, not_eligible, inactive
    """
    ok, reason = is_password_reset_eligible(user)
    if not ok:
        return None, reason

    if pending_request_for(user) is not None:
        return None, "pending"

    if recent_closed_request(user) is not None:
        return None, "cooldown"

    req = PasswordResetRequest.objects.create(
        user=user,
        status=PasswordResetRequest.Status.PENDING,
        requester_ip=requester_ip,
    )
    return req, ""


def validate_temporary_password(
    new_password: str, confirm_password: str, lang: str = "en"
) -> list[str]:
    """Return validation error messages for an admin-set temporary password."""
    errors: list[str] = []
    if not new_password or not confirm_password:
        errors.append(t(lang, "pwd_both_required"))
    if new_password and len(new_password) < MIN_PASSWORD_LENGTH:
        errors.append(t(lang, "password_min"))
    if new_password and confirm_password and new_password != confirm_password:
        errors.append(t(lang, "passwords_mismatch"))
    return errors


def flush_user_sessions(user: User) -> None:
    """Delete all Django sessions + UserSession rows belonging to ``user``."""
    now = timezone.now()
    keys: list[str] = []
    for session in Session.objects.filter(expire_date__gte=now):
        data = session.get_decoded()
        if str(data.get("_auth_user_id")) == str(user.pk):
            keys.append(session.session_key)
            session.delete()
    if keys:
        from security.session_meta import delete_user_session_records_for_keys

        delete_user_session_records_for_keys(keys)
    else:
        from security.models import UserSession

        UserSession.objects.filter(user=user).delete()


def cancel_pending_requests(
    user: User, *, by: User | None = None, note: str = "", lang: str = "en"
) -> None:
    """Mark all pending requests for ``user`` as dismissed (e.g. admin set password directly)."""
    now = timezone.now()
    PasswordResetRequest.objects.filter(
        user=user,
        status=PasswordResetRequest.Status.PENDING,
    ).update(
        status=PasswordResetRequest.Status.DISMISSED,
        resolved_at=now,
        resolved_by=by,
        admin_note=note or t(lang, "pwd_admin_note_cancelled"),
    )


@transaction.atomic
def apply_admin_temporary_password(
    *,
    target: User,
    new_password: str,
    changed_by: User,
    source: str,
    request: PasswordResetRequest | None = None,
    admin_note: str = "",
    lang: str = "en",
) -> PasswordChangeEvent:
    """
    Set a temporary password, force password-setup on next login, flush sessions,
    resolve/cancel pending requests, and write an audit event.
    """
    if len(new_password) < MIN_PASSWORD_LENGTH:
        raise ValueError(t(lang, "password_min"))

    target.set_password(new_password)
    target.save(update_fields=["password"])

    profile, _ = UserProfile.objects.get_or_create(user=target)
    if profile.password_setup_completed:
        profile.password_setup_completed = False
        profile.save(update_fields=["password_setup_completed", "updated_at"])

    now = timezone.now()
    if request is not None:
        request.status = PasswordResetRequest.Status.RESOLVED
        request.resolved_at = now
        request.resolved_by = changed_by
        if admin_note:
            request.admin_note = admin_note
        request.save(update_fields=["status", "resolved_at", "resolved_by", "admin_note"])
    else:
        cancel_pending_requests(
            target,
            by=changed_by,
            note=admin_note or t(lang, "pwd_admin_note_cancelled"),
            lang=lang,
        )

    event = PasswordChangeEvent.objects.create(
        user=target,
        changed_by=changed_by,
        source=source,
        request=request,
    )
    flush_user_sessions(target)
    return event


def dismiss_password_reset_request(
    *,
    request: PasswordResetRequest,
    dismissed_by: User,
    admin_note: str = "",
    lang: str = "en",
) -> PasswordResetRequest:
    if request.status != PasswordResetRequest.Status.PENDING:
        raise ValueError(t(lang, "msg_pwd_request_not_pending"))
    request.status = PasswordResetRequest.Status.DISMISSED
    request.resolved_at = timezone.now()
    request.resolved_by = dismissed_by
    if admin_note:
        request.admin_note = admin_note
    request.save(update_fields=["status", "resolved_at", "resolved_by", "admin_note"])
    return request


def pending_request_count() -> int:
    return PasswordResetRequest.objects.filter(status=PasswordResetRequest.Status.PENDING).count()


def password_changes_this_month_count() -> int:
    """Count password changes in the current Asia/Riyadh calendar month."""
    start = start_of_riyadh_month()
    end = start_of_next_riyadh_month()
    return PasswordChangeEvent.objects.filter(
        created_at__gte=start,
        created_at__lt=end,
    ).count()
