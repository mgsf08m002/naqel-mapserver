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


def _geometry_looks_like_wgs84(geometry):
    """
    Heuristic check to determine if a GeoJSON geometry already appears to be in WGS84.

    Returns True when coordinates fall within the typical longitude/latitude ranges.
    """
    try:
        if not geometry:
            return True

        geom_type = geometry.get("type")
        coords = geometry.get("coordinates")
        if not coords:
            return True

        def _iter_points(values):
            """
            Recursively yield coordinate pairs from a nested coordinates array.
            Supports LineString, MultiLineString and similar geometries.
            """
            if not isinstance(values, (list, tuple)):
                return

            if values and isinstance(values[0], (int, float, str)):
                # Treat this as a single coordinate pair
                yield values
                return

            for child in values:
                for pt in _iter_points(child):
                    yield pt

        seen = 0
        for pt in _iter_points(coords):
            if not pt or len(pt) < 2:
                continue
            try:
                lng = float(pt[0])
                lat = float(pt[1])
            except (TypeError, ValueError):
                continue

            # Any coordinate outside WGS84 bounds means this is almost certainly
            # a projected geometry (e.g. WebMercator) rather than lon/lat.
            if not (-180.0 <= lng <= 180.0 and -90.0 <= lat <= 90.0):
                return False

            seen += 1
            # We don't need to inspect every point; a representative sample is enough
            if seen >= 1000:
                break

        # If we saw no valid points, assume WGS84 to avoid accidental re-projection.
        # Otherwise, all inspected points were in-range so this looks like WGS84.
        return True
    except Exception:
        # On any parsing error, assume WGS84 to avoid corrupting data
        return True


def _ensure_wgs84_geometry(geometry, source_srid=3857):
    """
    Normalize a GeoJSON geometry to WGS84 (EPSG:4326) when it appears to be in a
    projected coordinate system such as WebMercator (EPSG:3857).
    """
    if not geometry:
        return geometry

    # Fast path: geometry already looks like WGS84
    if _geometry_looks_like_wgs84(geometry):
        return geometry

    try:
        geom = GEOSGeometry(json.dumps(geometry), srid=source_srid)
        geom.transform(4326)
        return json.loads(geom.json)
    except Exception:
        # If transformation fails, return the original geometry so that callers
        # can still decide how to handle it.
        return geometry


def _get_riyadh_road_geometry_wgs84(road_id):
    """
    Fetch RiyadhRoad.geom from the base network and normalize it to WGS84.
    This uses the road geometry as the single source of truth for Riyadh
    road shapes, independent of what may have been stored in edit requests.
    """
    if road_id is None:
        return None

    try:
        # RiyadhRoad is configured to use the "riyadh_roads" database alias
        # when present; fall back to the default connection otherwise.
        try:
            road = RiyadhRoad.objects.using("riyadh_roads").get(id=float(road_id))
        except Exception:
            road = RiyadhRoad.objects.get(id=float(road_id))

        geom = getattr(road, "geom", None)
        if not geom:
            return None

        try:
            # geom is a GEOS geometry with SRID 3857; transform in-place.
            geom.transform(4326)
        except Exception:
            # If transform fails, fall back to raw JSON
            return json.loads(geom.json)

        return json.loads(geom.json)
    except Exception:
        # If anything goes wrong (e.g. road missing), caller can decide how to fall back.
        return None


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

        # Normalize incoming geometry so that all stored edit requests use WGS84.
        raw_geometry = data.get("geometry")
        normalized_geometry = _ensure_wgs84_geometry(raw_geometry, source_srid=3857)

        edit_request = LineEditRequest.objects.create(
            requester=request.user,
            geometry=normalized_geometry,
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
            if edit_request.is_riyadh_road:
                try:
                    _apply_riyadh_edit_to_base_network(edit_request)
                except Exception:
                    pass
            return JsonResponse(
                {
                    "success": True,
                    "message": "Edit saved successfully!",
                    "request_id": edit_request.id,
                    "auto_approved": True,
                }
            )

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


def _apply_riyadh_edit_to_base_network(edit_request):
    geometry_json = edit_request.geometry
    geom = None
    if geometry_json:
        geom = GEOSGeometry(json.dumps(geometry_json), srid=4326)
        try:
            geom.transform(3857)
        except Exception:
            geom = None

    fields = edit_request.fields_data or {}

    road_kwargs = {
        "name": fields.get("name") or "",
        "ref": fields.get("ref") or "",
        "fclass": fields.get("fclass") or "",
        "oneway": fields.get("oneway") or "",
        "maxspeed": fields.get("maxspeed"),
        "code": fields.get("code"),
        "bridge": fields.get("bridge") or "",
        "tunnel": fields.get("tunnel") or "",
        "layer": fields.get("layer"),
    }

    road = None
    if edit_request.riyadh_road_id is not None:
        try:
            road = RiyadhRoad.objects.using("riyadh_roads").get(id=float(edit_request.riyadh_road_id))
        except RiyadhRoad.DoesNotExist:
            road = None

    if road is None:
        road = RiyadhRoad.objects.using("riyadh_roads").create(
            id=float(edit_request.riyadh_road_id) if edit_request.riyadh_road_id is not None else None,
            **road_kwargs,
        )
    else:
        for key, value in road_kwargs.items():
            setattr(road, key, value)

    if geom is not None:
        road.geom = geom

    road.road_closure = edit_request.road_closure or 0
    road.save(using="riyadh_roads")


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def set_road_closure(request):
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
        if target_type == "riyadh_road":
            road = get_object_or_404(
                RiyadhRoad.objects.using("riyadh_roads"), id=float(target_id_int)
            )
            road.road_closure = road_closure
            road.save(using="riyadh_roads", update_fields=["road_closure"])
        else:
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
            profile_image_url = (
                profile.profile_image.url if profile and profile.profile_image else None
            )

            # Always base the manager review geometry on the actual geometry
            # stored with the edit request so that the line appears exactly
            # where it was drawn on the map.
            geometry = _ensure_wgs84_geometry(req.geometry, source_srid=3857)

            requests_data.append(
                {
                    "id": req.id,
                    "requester_name": req.requester.get_full_name()
                    or req.requester.username,
                    "requester_username": req.requester.username,
                    "requester_role": req.get_requester_role(),
                    "profile_image_url": profile_image_url,
                    "edit_type": req.edit_type,
                    "feature_type": req.current_feature_label or "Line",
                    "current_feature_label": req.current_feature_label or "Line",
                    "created_at": req.created_at.isoformat(),
                    "geometry": geometry,
                    "road_closure": req.road_closure,
                }
            )
        
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
        try:
            edit_request = get_object_or_404(LineEditRequest, id=request_id)
        except Http404:
            return JsonResponse(
                {
                    "success": False,
                    "message": "Edit request not found for the given id.",
                },
                status=404,
            )

        profile = getattr(edit_request.requester, "profile", None)
        profile_image_url = (
            profile.profile_image.url if profile and profile.profile_image else None
        )

        # For manager review, always use the geometry stored on the edit
        # request so that the line is rendered exactly where the editor drew
        # it on the map.
        geometry = _ensure_wgs84_geometry(edit_request.geometry, source_srid=3857)

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
                    "geometry": geometry,
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
        edit_request = get_object_or_404(LineEditRequest, id=request_id, status="pending")

        edit_request.approve(request.user)

        if edit_request.is_riyadh_road:
            try:
                _apply_riyadh_edit_to_base_network(edit_request)
            except Exception:
                pass

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
    try:
        approved_requests = (
            LineEditRequest.objects.filter(status="approved", is_riyadh_road=False)
            .order_by("-created_at")
        )

        superseded_ids = set()
        for req in approved_requests:
            if req.parent_approved_line_id:
                superseded_ids.add(int(req.parent_approved_line_id))

        lines_data = []
        for req in approved_requests:
            if req.id not in superseded_ids:
                geometry = _ensure_wgs84_geometry(req.geometry, source_srid=3857)
                lines_data.append(
                    {
                        "id": req.id,
                        "geometry": geometry,
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
            raw_geometry = json.loads(road.geom.json) if road.geom else None
        except Exception:
            raw_geometry = None

        # RiyadhRoad geometries are stored in WebMercator (EPSG:3857); convert
        # them to WGS84 before sending to the frontend so that MapLibre can
        # safely consume them and so that any subsequent edit requests store a
        # consistent coordinate reference system.
        geometry = _ensure_wgs84_geometry(raw_geometry, source_srid=3857)

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
            "road_closure": _sanitize_number(getattr(road, "road_closure", 0)),
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
            "road_closure": _sanitize_number(getattr(road, "road_closure", 0)) or 0,
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
