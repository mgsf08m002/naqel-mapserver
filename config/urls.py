"""URL configuration. See https://docs.djangoproject.com/en/6.0/topics/http/urls/"""
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic.base import RedirectView

urlpatterns = [
    path(
        "favicon.ico",
        RedirectView.as_view(url="/static/auth/images/geotrak-browser-icon.png?v=2", permanent=False),
        name="favicon",
    ),
    path('', include('home.urls')),
    path('', include('auth.urls')),
    path('system-admin/', include('system_admin.urls')),
    path('manager/', include('manager.urls')),
    path('editor/', include('editor.urls')),
    path('mapping/', include('mapping.urls')),
    path('security/', include('security.urls')),
    path('symbology/', include('symbology.urls')),
    path('layer_uploader/', include('layer_uploader.urls')),

]

if settings.DEBUG:
    from django.contrib.staticfiles.urls import staticfiles_urlpatterns
    urlpatterns += staticfiles_urlpatterns()
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
