from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse, Http404
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.contrib.gis.geos import GEOSGeometry, Polygon
from django.db import transaction, connections
from django.db.models import Max
from decimal import Decimal
import json
import math
import time

from .models import LineEditRequest, RiyadhRoad


def _tiles_version_ms():
    """Server-side version used to refresh tiles when the base network changes."""
    return int(time.time_ns() // 1_000_000)


def map_view(request):
    """Render the main KSA map editing view."""
    return render(request, 'mapping/map.html')


def _geometry_looks_like_wgs84(geometry):
    """Return True when a GeoJSON geometry already appears to be in WGS84."""
    try:
        if not geometry:
            return True

        geom_type = geometry.get("type")
        coords = geometry.get("coordinates")
        if not coords:
            return True

        def _iter_points(values):
            if not isinstance(values, (list, tuple)):
                return

            if values and isinstance(values[0], (int, float, str)):
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

            if not (-180.0 <= lng <= 180.0 and -90.0 <= lat <= 90.0):
                return False

            seen += 1
            if seen >= 1000:
                break

        return True
    except Exception:
        return True


def _ensure_wgs84_geometry(geometry, source_srid=3857):
    """Normalize a GeoJSON geometry to WGS84 when it looks projected."""
    if not geometry:
        return geometry

    if _geometry_looks_like_wgs84(geometry):
        return geometry

    try:
        geom = GEOSGeometry(json.dumps(geometry), srid=source_srid)
        geom.transform(4326)
        return json.loads(geom.json)
    except Exception:
        return geometry


def _get_riyadh_road_geometry_wgs84(road_gid):
    """Fetch a RiyadhRoad geometry by gid and return it in WGS84."""
    if road_gid is None:
        return None

    try:
        road = RiyadhRoad.objects.using("riyadh_roads").get(gid=int(road_gid))

        geom = getattr(road, "geom", None)
        if not geom:
            return None

        try:
            geom.transform(4326)
        except Exception:
            return json.loads(geom.json)

        return json.loads(geom.json)
    except Exception:
        return None


def _derive_feature_label_from_riyadh_road(road):
    """Derive a human‑readable feature label from a RiyadhRoad instance."""
    fclass = (road.fclass or "").strip().lower()

    fclass_to_label = {
        "motorway": "Motorway",
        "motorway_link": "Motorway Link",
        "trunk": "Trunk Road",
        "trunk_link": "Trunk Link",
        "primary": "Primary Road",
        "primary_link": "Primary Link",
        "secondary": "Secondary Road",
        "secondary_link": "Secondary Link",
        "tertiary": "Tertiary Road",
        "tertiary_link": "Tertiary Link",
        "residential": "Residential Road",
        "living_street": "Living Street",
        "service": "Service Road",
        "unclassified": "Unclassified Road",
        "track": "Track",
        "footway": "Footway",
        "steps": "Steps",
        "path": "Path",
        "cycleway": "Cycleway",
    }

    label = fclass_to_label.get(fclass)
    if label:
        return label

    if fclass:
        return fclass.replace("_", " ").title()

    return "Line"


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def save_line_edit_request(request):
    """Save a line edit request and handle auto‑approval rules."""
    try:
        data = json.loads(request.body.decode("utf-8"))

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

        closure_changed = bool(data.get("closure_changed"))

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
            road_closure=road_closure,
            is_riyadh_road=is_riyadh_road,
            riyadh_road_id=riyadh_road_id_int,
        )

        created_request_id = edit_request.id
        auto_approved = False
        remote_road_id = None

        if closure_changed or is_manager:
            try:
                if (edit_request.edit_type or "").upper() == "DELETE":
                    _apply_delete_to_base_network(edit_request)
                elif edit_request.is_riyadh_road:
                    _apply_riyadh_edit_to_base_network(edit_request)
                    remote_road_id = edit_request.riyadh_road_id
                else:
                    remote_road_id = _apply_manual_approval_to_remote_network(edit_request)
                edit_request.approve(request.user)
                auto_approved = True
            except Exception as e:
                return JsonResponse(
                    {
                        "success": False,
                        "message": f"Failed to apply approved edit to remote network: {str(e)}",
                    },
                    status=500,
                )

            try:
                edit_request.delete()
            except Exception:
                pass

        if auto_approved:
            return JsonResponse(
                {
                    "success": True,
                    "message": "Edit saved successfully!",
                    "request_id": created_request_id,
                    "auto_approved": True,
                    "remote_road_id": remote_road_id,
                    "tiles_version": _tiles_version_ms(),
                }
            )

        return JsonResponse(
            {
                "success": True,
                "message": "Your requested edit has been sent to Manager and will be approved/rejected accordingly.",
                "request_id": created_request_id,
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


def _apply_manual_approval_to_remote_network(edit_request):
    """Create a new RiyadhRoad row for an approved manual line, then return its assigned id."""
    if not edit_request:
        return None

    if edit_request.is_riyadh_road:
        return edit_request.riyadh_road_id

    geometry_json = edit_request.geometry
    if not geometry_json:
        raise ValueError("Missing geometry for approved manual line.")

    fields = edit_request.fields_data or {}

    with transaction.atomic(using="riyadh_roads"):
        max_id = RiyadhRoad.objects.using("riyadh_roads").aggregate(max_id=Max("id")).get("max_id")
        next_id = int(max_id or 0) + 1

        # Insert using PostGIS to guarantee correct SRID/projection and MultiLineString type.
        geometry_geojson = json.dumps(geometry_json)
        name = fields.get("name") or ""
        ref = fields.get("ref") or ""
        fclass = fields.get("fclass") or ""
        oneway = fields.get("oneway") or ""
        maxspeed = fields.get("maxspeed")
        code = fields.get("code")
        bridge = fields.get("bridge") or ""
        tunnel = fields.get("tunnel") or ""
        layer = fields.get("layer")
        road_closure = edit_request.road_closure or 0

        with connections["riyadh_roads"].cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO public.riyadh_roads
                    (id, geom, name, ref, fclass, oneway, maxspeed, code, bridge, tunnel, layer, road_closure)
                VALUES
                    (
                        %s,
                        ST_Multi(
                            ST_Transform(
                                ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                                3857
                            )
                        ),
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                """,
                [
                    float(next_id),
                    geometry_geojson,
                    name,
                    ref,
                    fclass,
                    oneway,
                    maxspeed,
                    code,
                    bridge,
                    tunnel,
                    layer,
                    road_closure,
                ],
            )

        return next_id


def _get_user_is_manager(user):
    profile = getattr(user, "profile", None)
    return bool(profile and profile.role == "manager")


def _apply_delete_to_base_network(edit_request):
    """Apply a delete request to the remote base network (hard delete)."""
    if not edit_request:
        return

    if (edit_request.edit_type or "").upper() != "DELETE":
        return

    if not edit_request.is_riyadh_road or edit_request.riyadh_road_id is None:
        raise ValueError("Delete requests must target a Riyadh road gid.")

    identifier = edit_request.riyadh_road_id
    road = RiyadhRoad.objects.using("riyadh_roads").get(gid=int(identifier))
    road.delete(using="riyadh_roads")


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def create_delete_request(request):
    """Create a delete request for a RiyadhRoad (remote base network)."""
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
    target_gid = data.get("target_id")

    if target_type != "riyadh_road":
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid target_type. Use 'riyadh_road'.",
            },
            status=400,
        )

    try:
        target_gid_int = int(target_gid)
    except (TypeError, ValueError):
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid or missing target_id.",
            },
            status=400,
        )

    is_manager = _get_user_is_manager(request.user)

    # Resolve target and capture a geometry snapshot for review.
    is_riyadh_road = False
    riyadh_road_id_int = None
    geometry = None
    current_feature_label = None
    feature_type = None
    fields_data = {}
    tags_data = []
    relations_data = []

    try:
        is_riyadh_road = True
        riyadh_road_id_int = target_gid_int

        road = get_object_or_404(RiyadhRoad.objects.using("riyadh_roads"), gid=int(target_gid_int))
        geometry = _get_riyadh_road_geometry_wgs84(target_gid_int)
        feature_label = _derive_feature_label_from_riyadh_road(road)
        current_feature_label = feature_label
        feature_type = feature_label

        # Optional client snapshots, used only for display convenience.
        fields_data = data.get("fields_data") or {}
        tags_data = data.get("tags_data") or []
        relations_data = data.get("relations_data") or []

    except Http404:
        return JsonResponse(
            {
                "success": False,
                "message": "Target not found.",
            },
            status=404,
        )

    if not geometry:
        return JsonResponse(
            {
                "success": False,
                "message": "Target geometry is missing and cannot be deleted.",
            },
            status=400,
        )

    delete_request = LineEditRequest.objects.create(
        requester=request.user,
        status="pending",
        edit_type="DELETE",
        geometry=_ensure_wgs84_geometry(geometry, source_srid=3857),
        feature_type=feature_type or "",
        current_feature_label=current_feature_label or "Line",
        fields_data=fields_data,
        tags_data=tags_data,
        relations_data=relations_data,
        is_riyadh_road=is_riyadh_road,
        riyadh_road_id=riyadh_road_id_int,
    )

    auto_approved = False
    if is_manager:
        try:
            _apply_delete_to_base_network(delete_request)
            delete_request.approve(request.user)
            auto_approved = True

            try:
                delete_request.delete()
            except Exception:
                pass
        except Exception as e:
            return JsonResponse(
                {
                    "success": False,
                    "message": f"Failed to apply delete to remote network: {str(e)}",
                },
                status=500,
            )

    return JsonResponse(
        {
            "success": True,
            "message": "Delete request submitted." if not auto_approved else "Delete request approved and applied.",
            "request_id": delete_request.id,
            "auto_approved": auto_approved,
            **({"tiles_version": _tiles_version_ms()} if auto_approved else {}),
        }
    )


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
    target_gid = data.get("target_id")
    raw_closure = data.get("road_closure", 0)

    if target_type != "riyadh_road":
        return JsonResponse(
            {
                "success": False,
                "message": "Invalid target_type. Use 'riyadh_road'.",
            },
            status=400,
        )

    try:
        target_gid_int = int(target_gid)
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
        road = get_object_or_404(
            RiyadhRoad.objects.using("riyadh_roads"), gid=int(target_gid_int)
        )
        road.road_closure = road_closure
        road.save(using="riyadh_roads", update_fields=["road_closure"])

        return JsonResponse(
            {
                "success": True,
                "target_type": target_type,
                "target_id": target_gid_int,
                "road_closure": road_closure,
                "tiles_version": _tiles_version_ms(),
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
    """Return all pending line edit requests for manager review."""
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        requests = LineEditRequest.objects.filter(status="pending").select_related(
            "requester", "requester__profile"
        ).order_by("-created_at")
        
        requests_data = []
        for req in requests:
            profile = getattr(req.requester, "profile", None)
            profile_image_url = (
                profile.profile_image.url if profile and profile.profile_image else None
            )

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
    """Return full details of a single edit request for manager review."""
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
        remote_road_id = None

        if (edit_request.edit_type or "").upper() == "DELETE":
            _apply_delete_to_base_network(edit_request)
        else:
            if edit_request.is_riyadh_road:
                _apply_riyadh_edit_to_base_network(edit_request)
                remote_road_id = edit_request.riyadh_road_id
            else:
                # Approved manual line: migrate to remote base network and remove local trace.
                remote_road_id = _apply_manual_approval_to_remote_network(edit_request)

        edit_request.approve(request.user)
        edit_request.delete()

        return JsonResponse(
            {
                "success": True,
                "message": "Edit request approved successfully",
                "remote_road_id": remote_road_id,
                "tiles_version": _tiles_version_ms(),
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


def get_approved_lines(request):
    raise Http404




@login_required
@require_http_methods(["GET"])
def get_riyadh_road_details(request, road_gid):
    """Return geometry and metadata for a single Riyadh road, addressed by gid."""
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
        road = RiyadhRoad.objects.using("riyadh_roads").get(gid=int(road_gid))
    except RiyadhRoad.DoesNotExist:
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

        road_identifier = int(road.gid)
        feature_label = _derive_feature_label_from_riyadh_road(road)
        payload = {
            "id": road_identifier,
            "riyadh_road_id": road_identifier,
            "is_riyadh_road": True,
            "geometry": geometry,
            "road_closure": _sanitize_number(getattr(road, "road_closure", 0)) or 0,
            "feature_type": feature_label,
            "current_feature_label": feature_label,
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
