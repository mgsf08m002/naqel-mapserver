"""Query-string filters for the My Edits list API."""

from __future__ import annotations

from datetime import datetime

from django.db.models import QuerySet

from .approval_categories import CATEGORY_LABELS

MY_EDITS_STATUS_FILTERS = frozenset({"pending", "approved", "rejected"})


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


def apply_my_edits_filters(qs: QuerySet, request) -> QuerySet:
    status_filter = (request.GET.get("status") or "").strip().lower()
    if status_filter in MY_EDITS_STATUS_FILTERS:
        qs = qs.filter(status=status_filter)

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
