import os
import tempfile
import zipfile
from collections import defaultdict

import fiona
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from django.urls import reverse

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
        request.session["options"] = [s["name"] for s in detected_shapefiles if s.get("name")]
        context["shapefiles"] = detected_shapefiles

        selectable = [s for s in detected_shapefiles if s.get("name") and not s.get("error")]
        if len(selectable) == 1:
            request.session["selected"] = selectable[0]["name"]
            return redirect("validate")

    return render(request, "layer_uploader/upload.html", context)


@login_required
def select_view(request):
    denied = _enforce_layer_uploader_access(request)
    if denied:
        return denied
    if request.method == "POST":
        request.session["selected"] = request.POST.get("selected")
        return redirect("validate")

    return render(
        request,
        "layer_uploader/select_shapefile.html",
        {
            "base_template": _resolve_base_template(request.user),
            "options": request.session.get("options", []),
        },
    )


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
            )
            for feat in new_features_data
        ])

        return redirect("success")

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
