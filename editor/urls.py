from django.urls import path
from . import views

app_name = 'editor'

urlpatterns = [
    path('', views.map_view, name='map'),
    path('account-information/', views.account_information_view, name='account_information'),
    path('my-edits/', views.my_edits_view, name='my_edits'),
    path('security/', views.security_view, name='security'),
    path('upload-profile-image/', views.upload_profile_image_view, name='upload_profile_image'),
    path('remove-profile-image/', views.remove_profile_image_view, name='remove_profile_image'),
]

