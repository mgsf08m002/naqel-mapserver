"""
Branded HTTP error pages (400 / 403 / 404 / 500 / CSRF).

Rendered without full template context processors so a broken DB or processor
cannot take down the error page itself (especially important for 500).
"""

from __future__ import annotations

from django.http import HttpResponse
from django.middleware.csrf import get_token
from django.template.loader import render_to_string
from django.views.decorators.csrf import requires_csrf_token

from config.ui_locale import LANGUAGES, DEFAULT, resolve
from config.ui_strings import UiText, t


def _language(request) -> str:
    if request is None:
        return DEFAULT
    try:
        lang = getattr(request, "ui_language", None) or resolve(request)
        return lang if lang in LANGUAGES else DEFAULT
    except Exception:
        return DEFAULT


def _error_context(request, *, status: int, title_key: str, body_key: str, doc_title_key: str):
    lang = _language(request)
    csrf_token = ""
    if request is not None:
        try:
            csrf_token = get_token(request)
        except Exception:
            csrf_token = ""

    next_path = "/"
    if request is not None:
        try:
            next_path = request.get_full_path() or "/"
        except Exception:
            next_path = "/"

    return {
        "request": request,
        "csrf_token": csrf_token,
        "ui_language": lang,
        "ui_dir": LANGUAGES[lang]["dir"],
        "ui": UiText(lang),
        "ui_languages": [
            {
                "code": code,
                "label": meta["label"],
                "short": meta["short"],
                "active": code == lang,
            }
            for code, meta in LANGUAGES.items()
        ],
        "error_status": status,
        "error_title": t(lang, title_key),
        "error_body": t(lang, body_key),
        "error_doc_title": t(lang, doc_title_key),
        "language_next": next_path,
    }


def _render_error(
    request,
    *,
    status: int,
    title_key: str,
    body_key: str,
    doc_title_key: str,
    template_name: str = "errors/error.html",
) -> HttpResponse:
    html = render_to_string(
        template_name,
        _error_context(
            request,
            status=status,
            title_key=title_key,
            body_key=body_key,
            doc_title_key=doc_title_key,
        ),
    )
    return HttpResponse(html, status=status, content_type="text/html; charset=utf-8")


def bad_request(request, exception=None):
    return _render_error(
        request,
        status=400,
        title_key="error_400_title",
        body_key="error_400_body",
        doc_title_key="error_400_doc_title",
    )


def permission_denied(request, exception=None):
    return _render_error(
        request,
        status=403,
        title_key="error_403_title",
        body_key="error_403_body",
        doc_title_key="error_403_doc_title",
    )


def page_not_found(request, exception=None):
    return _render_error(
        request,
        status=404,
        title_key="error_404_title",
        body_key="error_404_body",
        doc_title_key="error_404_doc_title",
    )


def server_error(request):
    return _render_error(
        request,
        status=500,
        title_key="error_500_title",
        body_key="error_500_body",
        doc_title_key="error_500_doc_title",
    )


@requires_csrf_token
def csrf_failure(request, reason=""):
    return _render_error(
        request,
        status=403,
        title_key="error_csrf_title",
        body_key="error_csrf_body",
        doc_title_key="error_csrf_doc_title",
    )


# DEBUG preview helpers (visual QA without turning DEBUG off).
def preview_400(request):
    return bad_request(request)


def preview_403(request):
    return permission_denied(request)


def preview_404(request):
    return page_not_found(request)


def preview_500(request):
    return server_error(request)


def preview_csrf(request):
    return csrf_failure(request)
