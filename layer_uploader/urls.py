from django.urls import path
from . import views

urlpatterns = [
    path('', views.upload_view, name='upload'),
    path('select/', views.select_view, name='select'),
    path('validate/', views.validate_view, name='validate'),
    path('success/', views.success_view, name='success'),
]