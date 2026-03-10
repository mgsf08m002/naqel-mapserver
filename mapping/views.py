from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse, Http404
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.contrib.gis.geos import GEOSGeometry, Polygon
from decimal import Decimal
import json
import math

from .models import LineEditRequest, RiyadhRoad


def map_view(request):
    """KSA Map Editing Module view."""
    return render(request, 'mapping/map.html')


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def save_line_edit_request(request):
    """Save a line edit request from Editor, System Admin, or Manager."""
    try:
        data = json.loads(request.body.decode("utf-8"))

        # Validate required fields
        if "geometry" not in data:
            return JsonResponse(
                {
                    "success": False,
                    "message": "Geometry is required",
                },
                status=400,
            )

        # Determine whether current user is a manager for auto-approval of
        # geometry/attribute edits (road closure itself is handled separately).
        profile = getattr(request.user, "profile", None)
        is_manager = profile and profile.role == "manager"

        # Normalize road closure and Riyadh road metadata from payload
        raw_road_closure = data.get("road_closure", 0)
        try:
            road_closure = int(raw_road_closure)
        except (TypeError, ValueError):
            road_closure = 0

        is_riyadh_road = bool(data.get("is_riyadh_road"))
        riyadh_road_id = data.get("riyadh_road_id")
        try:
            riyadh_road_id_int = (
                int(riyadh_road_id) if riyadh_road_id is not None else None
            )
        except (TypeError, ValueError):
            riyadh_road_id_int = None

        edit_request = LineEditRequest.objects.create(
            requester=request.user,
            geometry=data.get("geometry"),
            feature_type=data.get("feature_type", ""),
            current_feature_label=data.get("current_feature_label", "Line"),
            fields_data=data.get("fields_data", {}),
            tags_data=data.get("tags_data", []),
            relations_data=data.get("relations_data", []),
            parent_approved_line_id=int(data.get("approved_line_id"))
            if data.get("approved_line_id")
            else None,
            road_closure=road_closure,
            is_riyadh_road=is_riyadh_road,
            riyadh_road_id=riyadh_road_id_int,
        )

        if is_manager:
            edit_request.approve(request.user)
            return JsonResponse(
                {
                    "success": True,
                    "message": "Edit saved successfully!",
                    "request_id": edit_request.id,
                    "auto_approved": True,
                }
            )
        else:
            # Editor or System Admin - requires approval from manager
            return JsonResponse(
                {
                    "success": True,
                    "message": "Your requested edit has been sent to Manager and will be approved/rejected accordingly.",
                    "request_id": edit_request.id,
                    "auto_approved": False,
                }
            )

    except json.JSONDecodeError:
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid JSON data",
            },
            status=400,
        )
    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error saving edit request: {str(e)}",
            },
            status=500,
        )


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def set_road_closure(request):
    """
    Update road_closure immediately for an approved line.

    This endpoint is intentionally approval-free: road closure changes apply
    for all users (editors, managers, system admins) without manager approval.

    Expected JSON payload:
    {"target_type": "approved_line", "target_id": <int>, "road_closure": 0|1}
    """
    try:
        data = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid JSON data",
            },
            status=400,
        )

    target_type = data.get("target_type")
    target_id = data.get("target_id")
    raw_closure = data.get("road_closure", 0)

    if target_type not in ("approved_line", "riyadh_road"):
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid target_type. Use 'approved_line'.",
            },
            status=400,
        )

    # Riyadh road base network closure is not supported unless the source table
    # includes a `road_closure` column. Keep this endpoint strict to avoid
    # silent failures/mismatched schemas.
    if target_type == "riyadh_road":
        return JsonResponse(
            {
                "success": False,
                "message": "Riyadh road closure is not supported by the current source table schema.",
            },
            status=501,
        )

    try:
        target_id_int = int(target_id)
    except (TypeError, ValueError):
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid or missing target_id.",
            },
            status=400,
        )

    try:
        road_closure = int(raw_closure)
    except (TypeError, ValueError):
        road_closure = 0

    road_closure = 1 if road_closure == 1 else 0

    try:
        # approved_line: update the active approved line request so that
        # subsequent /approved-lines/ calls return the new closure value.
        line_request = get_object_or_404(
            LineEditRequest, pk=target_id_int, status="approved"
        )
        line_request.road_closure = road_closure
        line_request.save(update_fields=["road_closure"])

        return JsonResponse(
            {
                "success": True,
                "target_type": target_type,
                "target_id": target_id_int,
                "road_closure": road_closure,
            }
        )
    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error updating road closure: {str(e)}",
            },
            status=500,
        )


@login_required
def list_pending_requests(request):
    """List all pending line edit requests for Manager."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        requests = (
            LineEditRequest.objects.filter(status="pending")
            .select_related("requester", "requester__profile")
            .order_by("-created_at")
        )
        
        requests_data = []
        for req in requests:
            profile = getattr(req.requester, "profile", None)
            profile_image_url = profile.profile_image.url if profile and profile.profile_image else None
            
            requests_data.append({
                'id': req.id,
                'requester_name': req.requester.get_full_name() or req.requester.username,
                'requester_username': req.requester.username,
                'requester_role': req.get_requester_role(),
                'profile_image_url': profile_image_url,
                'edit_type': req.edit_type,
                'feature_type': req.current_feature_label or 'Line',
                'current_feature_label': req.current_feature_label or 'Line',
                'created_at': req.created_at.isoformat(),
                'geometry': req.geometry,
                'road_closure': req.road_closure,
            })
        
        return JsonResponse({
            'success': True,
            'requests': requests_data
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error fetching requests: {str(e)}'
        }, status=500)


@login_required
def get_edit_request_details(request, request_id):
    """Get full details of an edit request."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id)

        profile = getattr(edit_request.requester, "profile", None)
        profile_image_url = (
            profile.profile_image.url if profile and profile.profile_image else None
        )

        return JsonResponse(
            {
                "success": True,
                "request": {
                    "id": edit_request.id,
                    "requester_name": edit_request.requester.get_full_name()
                    or edit_request.requester.username,
                    "requester_username": edit_request.requester.username,
                    "requester_role": edit_request.get_requester_role(),
                    "profile_image_url": profile_image_url,
                    "edit_type": edit_request.edit_type,
                    "feature_type": edit_request.current_feature_label or "Line",
                    "current_feature_label": edit_request.current_feature_label
                    or "Line",
                    "geometry": edit_request.geometry,
                    "fields_data": edit_request.fields_data or {},
                    "tags_data": edit_request.tags_data or [],
                    "relations_data": edit_request.relations_data or [],
                    "created_at": edit_request.created_at.isoformat(),
                    "road_closure": edit_request.road_closure,
                    "is_riyadh_road": edit_request.is_riyadh_road,
                    "riyadh_road_id": edit_request.riyadh_road_id,
                },
            }
        )

    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error fetching request details: {str(e)}",
            },
            status=500,
        )


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def approve_edit_request(request, request_id):
    """Approve an edit request."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        edit_request = get_object_or_404(
            LineEditRequest, id=request_id, status="pending"
        )

        # Approve the edit request for geometry/attribute changes. Road closure
        # has already been applied immediately via set_road_closure and does
        # not depend on this approval step.
        edit_request.approve(request.user)

        return JsonResponse(
            {
                "success": True,
                "message": "Edit request approved successfully",
            }
        )

    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error approving request: {str(e)}",
            },
            status=500,
        )


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def reject_edit_request(request, request_id):
    """Reject an edit request."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id, status='pending')
        edit_request.reject(request.user)
        
        return JsonResponse({
            'success': True,
            'message': 'Edit request rejected'
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error rejecting request: {str(e)}'
        }, status=500)


@login_required
def get_approved_lines(request):
    """Get all approved lines to display on map.
    Excludes superseded lines (old versions that have been edited).
    """
    try:
        approved_requests = LineEditRequest.objects.filter(status="approved").order_by(
            "-created_at"
        )
        
        # Collect IDs of lines that have been superseded by newer versions
        superseded_ids = set()
        for req in approved_requests:
            if req.parent_approved_line_id:
                superseded_ids.add(int(req.parent_approved_line_id))
        
        # Build response with only non-superseded lines
        lines_data = []
        for req in approved_requests:
            if req.id not in superseded_ids:
                lines_data.append(
                    {
                        "id": req.id,
                        "geometry": req.geometry,
                        "feature_type": req.current_feature_label or "Line",
                        "current_feature_label": req.current_feature_label or "Line",
                        "fields_data": req.fields_data or {},
                        "tags_data": req.tags_data or [],
                        "relations_data": req.relations_data or [],
                        "road_closure": req.road_closure,
                        "is_riyadh_road": req.is_riyadh_road,
                        "riyadh_road_id": req.riyadh_road_id,
                    }
                )

        return JsonResponse(
            {
                "success": True,
                "lines": lines_data,
            }
        )

    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error fetching approved lines: {str(e)}",
            },
            status=500,
        )


@login_required
@require_http_methods(["GET"])
def get_riyadh_road_details(request, road_id):
    def _sanitize_number(value):
        if value is None:
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, (float, Decimal)):
            try:
                if not math.isfinite(float(value)):
                    return None
            except (TypeError, ValueError):
                return None
            return float(value)
        return value

    try:
        road = get_object_or_404(RiyadhRoad, id=float(road_id))
    except Http404:
        return JsonResponse(
            {
                "success": False,
                "message": "Riyadh road not found for the given id.",
            },
            status=404,
        )

    try:
        try:
            geometry = json.loads(road.geom.json) if road.geom else None
        except Exception:
            geometry = None

        fields_data = {
            "name": road.name or "",
            "ref": road.ref or "",
            "fclass": road.fclass or "",
            "oneway": road.oneway or "",
            "maxspeed": _sanitize_number(road.maxspeed),
            "osm_id": road.osm_id or "",
            "code": _sanitize_number(road.code),
            "bridge": road.bridge or "",
            "tunnel": road.tunnel or "",
            "layer": _sanitize_number(road.layer),
            "shape_length": _sanitize_number(getattr(road, "shape_length", None)),
        }

        tags_data = []
        for key, value in fields_data.items():
            if value is None or value == "":
                continue
            tags_data.append({"key": key, "value": str(value)})

        road_identifier = int(road.id) if road.id is not None else int(road.gid)
        payload = {
            "id": road_identifier,
            "riyadh_road_id": road_identifier,
            "is_riyadh_road": True,
            "geometry": geometry,
            "road_closure": 0,
            "feature_type": "Line",
            "current_feature_label": "Line",
            "fields_data": fields_data,
            "tags_data": tags_data,
            "relations_data": [],
        }

        return JsonResponse({"success": True, "road": payload})
    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error fetching Riyadh road details: {str(e)}",
            },
            status=500,
        )
