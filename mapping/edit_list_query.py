"""Shared query-string filters for My Edits and Review History list APIs."""

from __future__ import annotations

from datetime import datetime

from django.contrib.auth.models import AbstractBaseUser
from django.db.models import QuerySet

from .approval_categories import CATEGORY_LABELS

MY_EDITS_STATUS_FILTERS = frozenset({"pending", "approved", "rejected"})
REVIEW_HISTORY_STATUS_FILTERS = frozenset({"approved", "rejected"})
REVIEW_HISTORY_SCOPES = frozenset({"all", "mine"})


def parse_category_filters(request) -> list[str]:
    """Accept repeated or comma-separated ``category`` query params."""
    categories: list[str] = []
    for raw in request.GET.getlist("category"):
        for part in raw.split(","):
            key = part.strip()
            if key and key in CATEGORY_LABELS and key not in categories:
                categories.append(key)
    return categories


def parse_date_param(value: str | None):
    """Parse ``YYYY-MM-DD`` values for ``created_at`` date filtering."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_review_history_scope(request) -> str:
    scope = (request.GET.get("scope") or "all").strip().lower()
    return scope if scope in REVIEW_HISTORY_SCOPES else "all"


def _apply_status_filter(qs: QuerySet, request, allowed: frozenset[str]) -> QuerySet:
    status_filter = (request.GET.get("status") or "").strip().lower()
    if status_filter in allowed:
        qs = qs.filter(status=status_filter)
    return qs


def _apply_category_and_date_filters(qs: QuerySet, request) -> QuerySet:
    category_filters = parse_category_filters(request)
    if category_filters:
        qs = qs.filter(request_category__in=category_filters)

    start_date = parse_date_param(request.GET.get("start_date"))
    end_date = parse_date_param(request.GET.get("end_date"))
    if start_date:
        qs = qs.filter(created_at__date__gte=start_date)
    if end_date:
        qs = qs.filter(created_at__date__lte=end_date)
    return qs


def apply_my_edits_filters(qs: QuerySet, request) -> QuerySet:
    qs = _apply_status_filter(qs, request, MY_EDITS_STATUS_FILTERS)
    return _apply_category_and_date_filters(qs, request)


def filter_editor_submissions(qs: QuerySet) -> QuerySet:
    """Limit queryset rows to editor work that requires manager review."""
    return qs.filter(requester__profile__role="editor").exclude(
        requester__is_superuser=True
    )


def apply_review_history_filters(
    qs: QuerySet, request, user: AbstractBaseUser
) -> QuerySet:
    if parse_review_history_scope(request) == "mine":
        qs = qs.filter(reviewed_by=user)
    qs = _apply_status_filter(qs, request, REVIEW_HISTORY_STATUS_FILTERS)
    return _apply_category_and_date_filters(qs, request)
