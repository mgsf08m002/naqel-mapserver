from django.urls import path
from . import views

app_name = 'manager'

urlpatterns = [
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('account-information/', views.account_information_view, name='account_information'),
    path('security/', views.security_view, name='security'),
    path('upload-profile-image/', views.upload_profile_image_view, name='upload_profile_image'),
    path('remove-profile-image/', views.remove_profile_image_view, name='remove_profile_image'),
]

