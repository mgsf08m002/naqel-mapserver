from django.urls import path

from . import views

app_name = 'tile_access'

urlpatterns = [
    path('validate/', views.validate_tile_request, name='validate'),
]
