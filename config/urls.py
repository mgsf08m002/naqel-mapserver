"""URL configuration. See https://docs.djangoproject.com/en/6.0/topics/http/urls/"""
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('', include('home.urls')),
    path('', include('auth.urls')),
    path('system-admin/', include('system_admin.urls')),
    path('manager/', include('manager.urls')),
    path('editor/', include('editor.urls')),
    path('mapping/', include('mapping.urls')),
    path('security/', include('security.urls')),
    path('symbology/', include('symbology.urls')),
]

if settings.DEBUG:
    from django.contrib.staticfiles.urls import staticfiles_urlpatterns
    urlpatterns += staticfiles_urlpatterns()
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
