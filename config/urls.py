"""URL configuration. See https://docs.djangoproject.com/en/6.0/topics/http/urls/"""
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic.base import RedirectView

from config.ui_locale import set_ui_language

urlpatterns = [
    path(
        "favicon.ico",
        RedirectView.as_view(
            url=f"/static/auth/images/geotrak-browser-icon.png?v={settings.GEOTRAK_APP_VERSION}",
            permanent=False,
        ),
        name="favicon",
    ),
    path("set-language/", set_ui_language, name="set_ui_language"),
    path('', include('home.urls')),
    path('', include('auth.urls')),
    path('system-admin/', include('system_admin.urls')),
    path('manager/', include('manager.urls')),
    path('editor/', include('editor.urls')),
    path('mapping/', include('mapping.urls')),
    path('security/', include('security.urls')),
    path('symbology/', include('symbology.urls')),
    path('layer_uploader/', include('layer_uploader.urls')),
    # Nginx auth_request target for /tiles/* (blocked publicly by Nginx; see geo-infra).
    path('tiles-auth/', include('tile_access.urls')),

]

# Branded HTML error pages (active when DEBUG=False).
handler400 = "home.error_views.bad_request"
handler403 = "home.error_views.permission_denied"
handler404 = "home.error_views.page_not_found"
handler500 = "home.error_views.server_error"

if settings.DEBUG:
    from django.contrib.staticfiles.urls import staticfiles_urlpatterns

    from home import error_views as _error_views

    urlpatterns += [
        path("__errors__/400/", _error_views.preview_400, name="preview_error_400"),
        path("__errors__/403/", _error_views.preview_403, name="preview_error_403"),
        path("__errors__/404/", _error_views.preview_404, name="preview_error_404"),
        path("__errors__/500/", _error_views.preview_500, name="preview_error_500"),
        path("__errors__/csrf/", _error_views.preview_csrf, name="preview_error_csrf"),
    ]
    urlpatterns += staticfiles_urlpatterns()
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
