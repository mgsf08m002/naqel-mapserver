from django.urls import path

from . import views

app_name = "security"

urlpatterns = [
    path("api/sessions/", views.active_sessions_api, name="active_sessions_api"),
    path(
        "api/sessions/terminate/",
        views.terminate_session_api,
        name="terminate_session_api",
    ),
    path(
        "api/sessions/terminate-others/",
        views.terminate_other_sessions_api,
        name="terminate_other_sessions_api",
    ),
]
