import json
import os
import tempfile
import zipfile
from collections import defaultdict

import fiona
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .models import Feature, Layer
from .utils import coerce_epsg, find_new_features_against_riyadh_roads, simplify_crs

REQUIRED_EXTENSIONS = {".shp", ".shx", ".dbf"}


def _resolve_base_template(user):
    if user.is_superuser:
        return "system_admin/base.html"
    profile = getattr(user, "profile", None)
    if profile and profile.role == "manager":
        return "manager/base.html"
    if profile and profile.role == "editor":
        return "editor/base.html"
    return "system_admin/base.html"


def _has_layer_uploader_access(user):
    if user.is_superuser:
        return True
    profile = getattr(user, "profile", None)
    if not profile:
        return False
    if profile.role not in {"manager", "editor"}:
        return False
    return bool(profile.can_access_layer_uploader)


def _enforce_layer_uploader_access(request):
    if _has_layer_uploader_access(request.user):
        return None
    logout(request)
    return redirect(f"{reverse('auth:login')}?no_permission=1&permission_type=layer_uploader")


def _user_can_access_layer_review(user, layer):
    if not _has_layer_uploader_access(user):
        return False
    if user.is_superuser:
        return True
    return layer.uploaded_by_id == user.id


def _enforce_layer_review_access(request, layer):
    if _user_can_access_layer_review(request.user, layer):
        return None
    logout(request)
    return redirect(f"{reverse('auth:login')}?no_permission=1&permission_type=layer_uploader")


def _review_json_forbidden():
    return JsonResponse({"detail": "Forbidden"}, status=403)


def _property_entries(properties, max_rows=24):
    """Structured rows for the review table (readable vs raw JSON blob)."""
    if not properties or not isinstance(properties, dict):
        return []
    rows = []
    for key in sorted(properties.keys(), key=lambda k: str(k).lower()):
        if len(rows) >= max_rows:
            break
        val = properties[key]
        if isinstance(val, (dict, list)):
            try:
                val_str = json.dumps(val, ensure_ascii=False)
            except TypeError:
                val_str = str(val)
        else:
            val_str = "" if val is None else str(val)
        rows.append({"key": str(key), "value": val_str})
    return rows


def _feature_row_dict(feature):
    env = feature.geom.extent
    cx = (env[0] + env[2]) / 2
    cy = (env[1] + env[3]) / 2
    geom_json = json.loads(feature.geom.geojson)
    return {
        "id": feature.pk,
        "status": feature.status,
        "property_entries": _property_entries(feature.properties),
        "center": [cx, cy],
        "bbox": [[env[0], env[1]], [env[2], env[3]]],
        "geometry": geom_json,
    }


def _approved_features_geojson(layer_id):
    qs = Feature.objects.filter(layer_id=layer_id, status=Feature.Status.APPROVED).order_by("pk")
    features = []
    for f in qs:
        geom = json.loads(f.geom.geojson)
        props = {"upload_feature_id": f.pk}
        features.append({"type": "Feature", "id": f.pk, "geometry": geom, "properties": props})
    return {"type": "FeatureCollection", "features": features}


def _find_shapefile_path(temp_dir, base_name):
    for root, _, files in os.walk(temp_dir):
        for file_name in files:
            if file_name.startswith(base_name) and file_name.endswith(".shp"):
                return os.path.join(root, file_name)
    return None


def _collect_detected_shapefiles(temp_dir):
    grouped_extensions = defaultdict(set)
    for root, _, filenames in os.walk(temp_dir):
        for filename in filenames:
            base, ext = os.path.splitext(filename)
            grouped_extensions[base].add(ext.lower())

    valid_sets = [
        base_name
        for base_name, exts in grouped_extensions.items()
        if REQUIRED_EXTENSIONS.issubset(exts)
    ]

    detected = []
    for base_name in valid_sets:
        shp_path = _find_shapefile_path(temp_dir, base_name)
        if not shp_path:
            continue
        try:
            with fiona.open(shp_path) as source:
                crs_name, epsg = simplify_crs(source.crs)
                detected.append(
                    {
                        "name": base_name,
                        "crs_name": crs_name,
                        "epsg": epsg if epsg else "Not defined",
                        "count": len(source),
                    }
                )
        except Exception as exc:
            detected.append({"name": base_name, "error": str(exc)})

    return detected

@login_required
def upload_view(request):
    denied = _enforce_layer_uploader_access(request)
    if denied:
        return denied
    context = {"base_template": _resolve_base_template(request.user)}

    if request.method == "POST":
        if "selected" in request.POST:
            request.session["selected"] = request.POST.get("selected")
            return redirect("validate")

        files = request.FILES.getlist("files")
        temp_dir = tempfile.mkdtemp()

        for uploaded_file in files:
            path = os.path.join(temp_dir, uploaded_file.name)

            with open(path, "wb+") as dest:
                for chunk in uploaded_file.chunks():
                    dest.write(chunk)

            if uploaded_file.name.endswith(".zip"):
                with zipfile.ZipFile(path, "r") as zip_ref:
                    zip_ref.extractall(temp_dir)

        detected_shapefiles = _collect_detected_shapefiles(temp_dir)
        if not detected_shapefiles:
            context["error"] = "No valid shapefile found."
            return render(request, "layer_uploader/upload.html", context)

        request.session["temp_dir"] = temp_dir
        context["shapefiles"] = detected_shapefiles

        selectable = [s for s in detected_shapefiles if s.get("name") and not s.get("error")]
        if len(selectable) == 1:
            request.session["selected"] = selectable[0]["name"]
            return redirect("validate")

    return render(request, "layer_uploader/upload.html", context)


@login_required
def validate_view(request):
    denied = _enforce_layer_uploader_access(request)
    if denied:
        return denied
    base_template = _resolve_base_template(request.user)
    temp_dir = request.session.get("temp_dir")
    selected = request.session.get("selected")
    if not temp_dir or not selected:
        return render(
            request,
            "layer_uploader/upload.html",
            {"base_template": base_template, "error": "Session expired. Please upload files again."},
        )

    shp_path = _find_shapefile_path(temp_dir, selected)
    if not shp_path:
        return render(
            request,
            "layer_uploader/upload.html",
            {"base_template": base_template, "error": "Shapefile not found."},
        )

    with fiona.open(shp_path) as source:
        feature_count = len(source)
        crs_name, epsg = simplify_crs(source.crs)
    normalized_epsg = coerce_epsg(epsg)

    context = {
        "base_template": base_template,
        "name": selected,
        "count": feature_count,
        "crs_name": crs_name,
        "epsg": epsg if epsg else "Not defined",
    }

    if request.method == "POST":
        try:
            new_features_data = find_new_features_against_riyadh_roads(shp_path)
        except Exception as exc:
            context["error"] = f"Failed to compare uploaded features against Riyadh roads: {exc}"
            return render(request, "layer_uploader/validate.html", context)

        layer = Layer.objects.create(
            name=selected,
            uploaded_by=request.user,
            srid=normalized_epsg,
            total_features=feature_count,
            new_features=len(new_features_data),
        )

        # Store each new feature linked to this layer.
        Feature.objects.bulk_create([
            Feature(
                layer=layer,
                geom=feat["geom"],
                properties=feat["properties"],
                uploaded_by=request.user,
                status=Feature.Status.PENDING,
            )
            for feat in new_features_data
        ])

        return redirect("layer_review", layer_id=layer.pk)

    return render(request, "layer_uploader/validate.html", context)


@login_required
def success_view(request):
    denied = _enforce_layer_uploader_access(request)
    if denied:
        return denied
    return render(
        request,
        "layer_uploader/success.html",
        {"base_template": _resolve_base_template(request.user)},
    )


@login_required
def review_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    denied = _enforce_layer_review_access(request, layer)
    if denied:
        return denied
    base_template = _resolve_base_template(request.user)
    return render(
        request,
        "layer_uploader/review.html",
        {
            "base_template": base_template,
            "layer": layer,
            "riyadh_roads_tile_url": settings.RIYADH_ROADS_TILE_URL or "",
            "maptiler_api_key": settings.MAPTILER_API_KEY or "",
        },
    )


@login_required
@require_http_methods(["GET"])
def review_geojson_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not _user_can_access_layer_review(request.user, layer):
        return _review_json_forbidden()
    payload = _approved_features_geojson(layer.pk)
    return JsonResponse(payload)


@login_required
@require_http_methods(["GET"])
def review_table_json_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not _user_can_access_layer_review(request.user, layer):
        return _review_json_forbidden()
    rows = [_feature_row_dict(f) for f in Feature.objects.filter(layer=layer).order_by("pk")]
    counts = {"pending": 0, "approved": 0, "rejected": 0}
    for r in rows:
        counts[r["status"]] += 1
    return JsonResponse(
        {
            "layer": {"id": layer.pk, "name": layer.name},
            "counts": counts,
            "features": rows,
        }
    )


@login_required
@require_http_methods(["POST"])
def review_action_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not _user_can_access_layer_review(request.user, layer):
        return _review_json_forbidden()

    try:
        body = json.loads(request.body.decode() or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    action = body.get("action")
    feature_id = body.get("feature_id")

    if action == "approve_all":
        updated = Feature.objects.filter(layer=layer).update(status=Feature.Status.APPROVED)
        return JsonResponse({"ok": True, "updated": updated})

    if action == "reject_all":
        updated = Feature.objects.filter(layer=layer).update(status=Feature.Status.REJECTED)
        return JsonResponse({"ok": True, "updated": updated})

    if action not in ("approve", "reject") or feature_id is None:
        return JsonResponse({"detail": "Unknown action"}, status=400)

    try:
        feature_id = int(feature_id)
    except (TypeError, ValueError):
        return JsonResponse({"detail": "Invalid feature_id"}, status=400)

    feature = Feature.objects.filter(pk=feature_id, layer=layer).first()
    if not feature:
        return JsonResponse({"detail": "Feature not found"}, status=404)

    new_status = Feature.Status.APPROVED if action == "approve" else Feature.Status.REJECTED
    feature.status = new_status
    feature.save(update_fields=["status"])

    return JsonResponse({"ok": True})
