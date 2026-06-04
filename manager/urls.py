from django.urls import path
from . import views

app_name = 'manager'

urlpatterns = [
    path('', views.map_view, name='map'),
    path('my-edits/', views.my_edits_view, name='my_edits'),
    path('review-history/', views.review_history_view, name='review_history'),
    path('account-information/', views.account_information_view, name='account_information'),
    path('security/', views.security_view, name='security'),
    path('upload-profile-image/', views.upload_profile_image_view, name='upload_profile_image'),
    path('remove-profile-image/', views.remove_profile_image_view, name='remove_profile_image'),
]

