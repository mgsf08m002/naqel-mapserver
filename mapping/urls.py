from django.urls import path
from . import views

app_name = 'mapping'

urlpatterns = [
    path('', views.map_view, name='map'),
]

