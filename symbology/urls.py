from django.urls import path

from . import views

app_name = "symbology"

urlpatterns = [
    path("api/catalog/", views.symbology_catalog, name="catalog"),
]

