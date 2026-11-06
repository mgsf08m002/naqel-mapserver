"""Single source of truth for Asia/Riyadh (Saudi Arabia) wall-clock time.

Storage stays UTC via Django USE_TZ=True. Every user-facing date/time and every
Saudi calendar boundary must go through these helpers — nowhere else should
hard-code a timezone name.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

RIYADH_TZ_NAME = "Asia/Riyadh"
RIYADH_TZ = ZoneInfo(RIYADH_TZ_NAME)


def riyadh_now() -> datetime:
    """Current instant as an aware datetime in Asia/Riyadh."""
    return timezone.localtime(timezone.now(), RIYADH_TZ)


def to_riyadh(value: datetime | date | time | None) -> datetime | date | time | None:
    """
    Normalize so calendar/clock fields are Asia/Riyadh wall clock.

    Aware datetime → converted to Riyadh.
    Naive datetime / date / time → already treated as Riyadh wall clock
    (e.g. UserProfile.account_creation_date / account_creation_time).
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            return timezone.localtime(value, RIYADH_TZ)
        return value
    return value


def format_riyadh(value: datetime | None, fmt: str = "%Y-%m-%d %H:%M") -> str:
    """Format an aware/naive datetime for logs/admin strings in Asia/Riyadh."""
    when = to_riyadh(value)
    if when is None or not isinstance(when, datetime):
        return ""
    return when.strftime(fmt)


def start_of_riyadh_month(moment: datetime | None = None) -> datetime:
    """First instant of the current (or given) calendar month in Asia/Riyadh."""
    local = timezone.localtime(moment or timezone.now(), RIYADH_TZ)
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def start_of_previous_riyadh_month(moment: datetime | None = None) -> datetime:
    """First instant of the previous calendar month in Asia/Riyadh."""
    start = start_of_riyadh_month(moment)
    previous_day = start - timedelta(days=1)
    return previous_day.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def start_of_next_riyadh_month(moment: datetime | None = None) -> datetime:
    """First instant of the next calendar month in Asia/Riyadh."""
    start = start_of_riyadh_month(moment)
    if start.month == 12:
        return start.replace(year=start.year + 1, month=1)
    return start.replace(month=start.month + 1)
