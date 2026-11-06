"""UI language preference (English / Arabic) for chrome, logos, and document dir."""

from urllib.parse import urlparse

from django.shortcuts import redirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods

from config.ui_strings import UI_JS_KEYS, UiText, catalog_json

SESSION_KEY = "ui_language"
COOKIE_NAME = "ui_language"
COOKIE_MAX_AGE = 365 * 24 * 60 * 60
DEFAULT = "en"

LANGUAGES = {
    "en": {"dir": "ltr", "label": "English", "short": "EN"},
    "ar": {"dir": "rtl", "label": "العربية", "short": "عربي"},
}


def normalize(value: str | None) -> str:
    code = (value or "").strip().lower()
    return code if code in LANGUAGES else DEFAULT


def resolve(request) -> str:
    session_lang = request.session.get(SESSION_KEY)
    if session_lang in LANGUAGES:
        return session_lang
    cookie_lang = request.COOKIES.get(COOKIE_NAME)
    if cookie_lang in LANGUAGES:
        return cookie_lang
    return DEFAULT


def bind(request, language: str) -> str:
    language = normalize(language)
    request.ui_language = language
    request.ui_dir = LANGUAGES[language]["dir"]
    return language


class UiLocaleMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        bind(request, resolve(request))
        return self.get_response(request)


def ui_locale(request):
    language = getattr(request, "ui_language", None) or resolve(request)
    return {
        "ui_language": language,
        "ui_dir": LANGUAGES[language]["dir"],
        "ui": UiText(language),
        "ui_i18n_json": catalog_json(language, UI_JS_KEYS),
        "ui_languages": [
            {
                "code": code,
                "label": meta["label"],
                "short": meta["short"],
                "active": code == language,
            }
            for code, meta in LANGUAGES.items()
        ],
    }


def _safe_next(request, candidate: str | None) -> str:
    if candidate and url_has_allowed_host_and_scheme(
        candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return candidate
    referer = request.META.get("HTTP_REFERER")
    if referer:
        parsed = urlparse(referer)
        if not parsed.netloc or parsed.netloc == request.get_host():
            path = parsed.path or "/"
            if parsed.query:
                path = f"{path}?{parsed.query}"
            return path
    return "/"


@require_http_methods(["GET", "POST"])
def set_ui_language(request):
    language = bind(
        request,
        request.POST.get("language") or request.GET.get("language"),
    )
    request.session[SESSION_KEY] = language
    next_url = _safe_next(
        request,
        request.POST.get("next") or request.GET.get("next"),
    )
    set_path = reverse("set_ui_language")
    if next_url.startswith(set_path):
        next_url = "/"
    response = redirect(next_url)
    response.set_cookie(
        COOKIE_NAME,
        language,
        max_age=COOKIE_MAX_AGE,
        samesite="Lax",
        secure=request.is_secure(),
    )
    return response
