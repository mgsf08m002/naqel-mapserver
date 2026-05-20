"""
Django settings for naqel-mapserver. See:
https://docs.djangoproject.com/en/6.0/topics/settings/
https://docs.djangoproject.com/en/6.0/ref/settings/
"""

from pathlib import Path
import os
from urllib.parse import urlparse
from dotenv import load_dotenv

# Load environment variables from the .env file.
load_dotenv()

# Base project path, e.g. BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    """Parse a boolean environment variable safely."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    """Parse an integer environment variable safely."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


# Quick-start development settings; review Django’s deployment checklist before going live.

# SECURITY WARNING: keep the production secret key in the environment only.
SECRET_KEY = os.getenv('SECRET_KEY')
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is not set. Please set it in your .env file.")

# Optional MapTiler API key for basemap integration, kept in the environment only.
MAPTILER_API_KEY = os.getenv('MAPTILER_API_KEY', '').strip()

# Riyadh roads XYZ tile service for visualizing the road network; overridable via RIYADH_ROADS_TILE_URL.
RIYADH_ROADS_TILE_URL = os.getenv(
    "RIYADH_ROADS_TILE_URL",
    "http://139.162.60.105:3000/riyadh_roads/{z}/{x}/{y}",
).strip()
RIYADH_ROADS_TILE_PROXY_TIMEOUT_SECONDS = _env_int("RIYADH_ROADS_TILE_PROXY_TIMEOUT_SECONDS", 20)
RIYADH_ROADS_TILE_PROXY_CACHE_MAX_AGE = _env_int("RIYADH_ROADS_TILE_PROXY_CACHE_MAX_AGE", 3600)

# Derive the tile service origin (scheme + host) so CSP stays aligned with RIYADH_ROADS_TILE_URL.
_riyadh_tile_url = urlparse(RIYADH_ROADS_TILE_URL)
if _riyadh_tile_url.scheme and _riyadh_tile_url.netloc:
    RIYADH_ROADS_TILE_ORIGIN = f"{_riyadh_tile_url.scheme}://{_riyadh_tile_url.netloc}"
else:
    RIYADH_ROADS_TILE_ORIGIN = "http://139.162.60.105:3000"

# SECURITY WARNING: DEBUG must be False in production.
DEBUG = _env_bool('DEBUG', True)

ALLOWED_HOSTS = [
    h.strip()
    for h in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,139.162.60.105").split(",")
    if h.strip()
]

# Security flags: production should set these to True behind HTTPS.
SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = _env_bool("CSRF_COOKIE_SECURE", not DEBUG)
SECURE_SSL_REDIRECT = _env_bool("SECURE_SSL_REDIRECT", False if DEBUG else True)


# Application definition

INSTALLED_APPS = [
    'django.contrib.gis',  # Must appear before other apps for PostGIS support.
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'auth.apps.AuthConfig',
    'notifications',
    'system_admin',
    'manager',
    'editor',
    'mapping',
    'home',
    'security',
    'symbology',
    'layer_uploader',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'config.middleware.CSPMiddleware',  # Project CSP middleware.
    'security.middleware.SessionActivityMiddleware',
]

# Content Security Policy (CSP) settings; consider django-csp for richer production management.
if DEBUG:
    # Development CSP: relaxed to simplify local debugging.
    CSP_DEFAULT_SRC = ["'self'"]
    CSP_SCRIPT_SRC = ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net"]
    CSP_STYLE_SRC = ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"]
    CSP_FONT_SRC = ["'self'", "https://fonts.gstatic.com", "data:"]
    CSP_IMG_SRC = [
        "'self'",
        "data:",
        "blob:",
        "https://services.arcgisonline.com",
        "https://api.maptiler.com",
        "https://fonts.openmaptiles.org",
        RIYADH_ROADS_TILE_ORIGIN,
    ]
    CSP_CONNECT_SRC = [
        "'self'",
        "blob:",
        "https://services.arcgisonline.com",
        "https://api.maptiler.com",
        "https://fonts.openmaptiles.org",
        "https://unpkg.com",
        "https://cdn.jsdelivr.net",
        RIYADH_ROADS_TILE_ORIGIN,
    ]
    CSP_WORKER_SRC = ["'self'", "blob:"]  # Required for MapLibre GL workers.
else:
    # Production CSP: stricter defaults; django-csp is still recommended.
    CSP_DEFAULT_SRC = ["'self'"]
    CSP_SCRIPT_SRC = ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"]
    CSP_STYLE_SRC = ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"]
    CSP_FONT_SRC = ["'self'", "https://fonts.gstatic.com", "data:"]
    CSP_IMG_SRC = [
        "'self'",
        "data:",
        "blob:",
        "https://services.arcgisonline.com",
        "https://api.maptiler.com",
        "https://fonts.openmaptiles.org",
        RIYADH_ROADS_TILE_ORIGIN,
    ]
    CSP_CONNECT_SRC = [
        "'self'",
        "blob:",
        "https://services.arcgisonline.com",
        "https://api.maptiler.com",
        "https://fonts.openmaptiles.org",
        "https://unpkg.com",
        "https://cdn.jsdelivr.net",
        RIYADH_ROADS_TILE_ORIGIN,
    ]
    CSP_WORKER_SRC = ["'self'", "blob:"]  # Required for MapLibre GL workers.

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'system_admin.context_processors.user_profile',
                'mapping.context_processors.maptiler_api_key',
                'mapping.context_processors.riyadh_roads_tile_url',
                'layer_uploader.context_processors.manager_upload_approvals',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database configuration; see Django docs for full options.

DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": os.getenv("DB_NAME"),
        "USER": os.getenv("DB_USER", "postgres"),
        "PASSWORD": os.getenv("DB_PASSWORD"),
        "HOST": os.getenv("DB_HOST", "db"),
        "PORT": os.getenv("DB_PORT", "5432"),
    },
    "riyadh_roads": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": os.getenv("RIYADH_ROADS_DB_NAME"),
        "USER": os.getenv("RIYADH_ROADS_DB_USER"),
        "PASSWORD": os.getenv("RIYADH_ROADS_DB_PASSWORD"),
        "HOST": os.getenv("RIYADH_ROADS_DB_HOST"),
        "PORT": os.getenv("RIYADH_ROADS_DB_PORT"),
    },
}

if not DATABASES["default"]["NAME"]:
    raise ValueError("DB_NAME environment variable is not set. Please set it in your .env file.")
if not DATABASES["default"]["PASSWORD"]:
    raise ValueError("DB_PASSWORD environment variable is not set. Please set it in your .env file.")

if not DATABASES["riyadh_roads"]["NAME"]:
    raise ValueError("RIYADH_ROADS_DB_NAME environment variable is not set. Please set it in your .env file.")
if not DATABASES["riyadh_roads"]["PASSWORD"]:
    raise ValueError("RIYADH_ROADS_DB_PASSWORD environment variable is not set. Please set it in your .env file.")

DATABASE_ROUTERS = [
    "config.db_routers.RiyadhRoadsRouter",
]


# Password validation; reuse Django’s built-in validators.

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Authentication
LOGIN_URL = '/login/'


# Internationalization
LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'Asia/Riyadh'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, images)

STATIC_URL = 'static/'
STATICFILES_DIRS = [
    BASE_DIR / 'static',
]

# Media files (user uploads)
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# GDAL library path required by PostGIS; falls back to a common Linux location.
GDAL_LIBRARY_PATH = os.environ.get('GDAL_LIBRARY_PATH', '/usr/lib/x86_64-linux-gnu/libgdal.so')
