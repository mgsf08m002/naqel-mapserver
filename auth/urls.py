from django.urls import path
from . import views

app_name = 'auth'

urlpatterns = [
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('onetime/', views.onetime_view, name='onetime'),
    path('password-setup/', views.password_setup_view, name='password_setup'),
    path('api/login/', views.login_api, name='login_api'),
    path('api/onetime/', views.onetime_api, name='onetime_api'),
]

