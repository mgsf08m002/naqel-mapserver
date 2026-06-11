from django.urls import path
from . import views

app_name = 'mapping'

urlpatterns = [
    path(
        'api/riyadh-roads-map-sync/',
        views.riyadh_roads_map_sync,
        name='riyadh_roads_map_sync',
    ),
    path(
        'tiles/riyadh_roads/<int:z>/<int:x>/<int:y>/',
        views.riyadh_roads_tile_proxy,
        name='riyadh_roads_tile_proxy',
    ),
    path('api/save-line-edit/', views.save_line_edit_request, name='save_line_edit'),
    path('api/riyadh-road-labels/', views.riyadh_road_labels, name='riyadh_road_labels'),
    path('api/riyadh-road-search/', views.riyadh_road_search, name='riyadh_road_search'),
    path('api/request/delete/', views.create_delete_request, name='create_delete_request'),
    path('api/riyadh-road/<int:road_gid>/', views.get_riyadh_road_details, name='get_riyadh_road_details'),
    path('api/my-edit-requests/', views.list_my_edit_requests, name='list_my_edit_requests'),
    path(
        'api/manager-review-history/',
        views.list_manager_review_history,
        name='list_manager_review_history',
    ),
    path('api/pending-requests/', views.list_pending_requests, name='list_pending_requests'),
    path('api/request/<int:request_id>/', views.get_edit_request_details, name='get_request_details'),
    path('api/request/<int:request_id>/approve/', views.approve_edit_request, name='approve_request'),
    path('api/request/<int:request_id>/reject/', views.reject_edit_request, name='reject_request'),
]

