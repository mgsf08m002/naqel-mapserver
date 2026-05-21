from django.urls import path

from . import views

urlpatterns = [
    path("", views.upload_view, name="upload"),
    path("validate/", views.validate_view, name="validate"),
    path("success/", views.success_view, name="success"),
    path(
        "review/<int:layer_id>/features.geojson",
        views.review_geojson_view,
        name="layer_review_geojson",
    ),
    path(
        "review/<int:layer_id>/table.json",
        views.review_table_json_view,
        name="layer_review_table",
    ),
    path(
        "review/<int:layer_id>/action/",
        views.review_action_view,
        name="layer_review_action",
    ),
    path(
        "review/<int:layer_id>/submit/",
        views.submit_layer_view,
        name="layer_submit",
    ),
    path("review/<int:layer_id>/", views.review_view, name="layer_review"),
]
