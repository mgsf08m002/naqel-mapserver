from django.urls import path
from . import views

app_name = 'system_admin'

urlpatterns = [
    path('', views.map_view, name='map'),
    path('users/', views.users_view, name='users'),
    path('users/add/', views.add_user_view, name='add_user'),
    path('users/edit/', views.edit_user_view, name='edit_user'),
    path('users/delete/', views.delete_user_view, name='delete_user'),
    path('users/all/', views.all_users_view, name='all_users'),
    path('users/view/<int:user_id>/', views.view_user_view, name='view_user'),
    path('manage-passwords/', views.manage_passwords_view, name='manage_passwords'),
    path('permissions/', views.permissions_view, name='permissions'),
    path('permissions/grant/<int:user_id>/', views.grant_permission_view, name='grant_permission'),
    path('permissions/check/<int:user_id>/', views.check_permission_view, name='check_permission'),
    path('my-edits/', views.my_edits_view, name='my_edits'),
    path('account-information/', views.account_information_view, name='account_information'),
    path('security/', views.security_view, name='security'),
    path('upload-profile-image/', views.upload_profile_image_view, name='upload_profile_image'),
    path('remove-profile-image/', views.remove_profile_image_view, name='remove_profile_image'),
    # API endpoints
    path('api/users/', views.users_api_view, name='users_api'),
    path('api/users/<int:user_id>/', views.user_detail_api_view, name='user_detail_api'),
    path('api/permissions/', views.permissions_api_view, name='permissions_api'),
    path('api/permissions/<int:user_id>/', views.update_permissions_api_view, name='update_permissions_api'),
]

