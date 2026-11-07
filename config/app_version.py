"""Product version for GeoTrak Maps (not git tags, not tile cache versions)."""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = BASE_DIR / "VERSION"
WHATS_NEW_DIR = BASE_DIR / "static" / "images" / "whats-new"
DEFAULT_VERSION = "2.0.0"


def resolve_app_version() -> str:
    """
    Resolve product version without Django settings.

    Precedence:
      1. GEOTRAK_APP_VERSION env (production override)
      2. VERSION file at repo root
      3. Hard default
    """
    env = (os.getenv("GEOTRAK_APP_VERSION") or "").strip()
    if env:
        return env
    try:
        text = VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return DEFAULT_VERSION
    return text or DEFAULT_VERSION


def get_app_version() -> str:
    """Configured product version after Django settings are loaded."""
    from django.conf import settings

    configured = getattr(settings, "GEOTRAK_APP_VERSION", None)
    if configured:
        return str(configured).strip() or resolve_app_version()
    return resolve_app_version()


def whats_new_banner_static(version: str, language: str) -> str:
    """
    Static path for the What's New banner for this release + UI language.

    Convention: static/images/whats-new/<version>-en.png | <version>-ar.png
    Empty string when no banner ships for that version.
    """
    lang = "ar" if language == "ar" else "en"
    filename = f"{version}-{lang}.png"
    if not (WHATS_NEW_DIR / filename).is_file():
        return ""
    return f"images/whats-new/{filename}"


def app_version_context(request) -> dict[str, str]:
    from config.ui_locale import resolve
    from config.ui_strings import t

    version = get_app_version()
    language = getattr(request, "ui_language", None) or resolve(request)
    return {
        "app_version": version,
        "asset_v": version,
        "app_version_display": t(language, "app_version_label", version=version),
        "whats_new_banner": whats_new_banner_static(version, language),
    }
