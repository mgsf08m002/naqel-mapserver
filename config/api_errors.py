"""
Centralized API error responses.

Unexpected exceptions are logged server-side. Clients only receive curated,
user-facing copy - never str(exc), tracebacks, or driver/SQL text.
"""

from __future__ import annotations

import logging
from typing import Any

from django.http import JsonResponse

from config.ui_locale import resolve
from config.ui_strings import t

logger = logging.getLogger(__name__)

DEFAULT_MESSAGE_KEY = "generic_error"
DEFAULT_FALLBACK = "Something went wrong. Try again."


def client_message(request=None, key: str = DEFAULT_MESSAGE_KEY, fallback: str | None = None) -> str:
    """Resolve a localized user-facing error string for the current request."""
    lang = None
    if request is not None:
        lang = getattr(request, "ui_language", None) or resolve(request)
    text = t(lang, key)
    if text == key:
        return fallback or DEFAULT_FALLBACK
    return text


def json_api_error(
    request=None,
    *,
    status: int = 500,
    message_key: str = DEFAULT_MESSAGE_KEY,
    message: str | None = None,
    exc: BaseException | None = None,
    extra: dict[str, Any] | None = None,
    log: bool = True,
) -> JsonResponse:
    """
    Return a standard ``{success: false, message: ...}`` payload.

    Pass ``exc`` for unexpected failures so the real error is logged and never
    included in the response body.
    """
    if log and exc is not None:
        logger.error("API request failed", exc_info=exc)
    elif log and status >= 500:
        logger.error("API request failed with status %s (%s)", status, message_key)

    payload: dict[str, Any] = {
        "success": False,
        "message": message
        if message is not None
        else client_message(request, message_key),
    }
    if extra:
        payload.update(extra)
    return JsonResponse(payload, status=status)


def json_detail_error(
    request=None,
    *,
    status: int = 500,
    message_key: str = DEFAULT_MESSAGE_KEY,
    message: str | None = None,
    exc: BaseException | None = None,
    log: bool = True,
) -> JsonResponse:
    """Layer-uploader style ``{detail: ...}`` error payload."""
    if log and exc is not None:
        logger.error("API detail request failed", exc_info=exc)
    elif log and status >= 500:
        logger.error("API detail request failed with status %s (%s)", status, message_key)

    text = (
        message
        if message is not None
        else client_message(request, message_key)
    )
    return JsonResponse({"detail": text}, status=status)
