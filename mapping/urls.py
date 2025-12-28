from django.urls import path
from . import views

app_name = 'mapping'

urlpatterns = [
    path('', views.map_view, name='map'),
    path('api/save-line-edit/', views.save_line_edit_request, name='save_line_edit'),
    path('api/pending-requests/', views.list_pending_requests, name='list_pending_requests'),
    path('api/request/<int:request_id>/', views.get_edit_request_details, name='get_request_details'),
    path('api/request/<int:request_id>/approve/', views.approve_edit_request, name='approve_request'),
    path('api/request/<int:request_id>/reject/', views.reject_edit_request, name='reject_request'),
    path('api/approved-lines/', views.get_approved_lines, name='get_approved_lines'),
]

