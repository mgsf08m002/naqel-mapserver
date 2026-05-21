import json

import fiona
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .access import (
    can_access_uploader_review,
    enforce_layer_uploader_access,
    enforce_uploader_review_access,
)
from .api import features_geojson, table_payload
from .models import Feature, Layer
from .presentation import post_upload_map_url, resolve_base_template, review_page_context
from .services import (
    apply_uploader_review_action,
    map_preview_statuses_uploader,
    submit_layer,
)
from .shapefile_io import collect_detected_shapefiles, extract_upload_to_temp, find_shapefile_path
from .utils import coerce_epsg, find_new_features_against_riyadh_roads, simplify_crs


def _json_forbidden():
    return JsonResponse({"detail": "Forbidden"}, status=403)


def _parse_action_body(request):
    try:
        return json.loads(request.body.decode() or "{}")
    except json.JSONDecodeError:
        return None


def _parse_feature_id(body) -> int | None:
    raw = body.get("feature_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _action_error_response(exc: Exception) -> JsonResponse:
    if isinstance(exc, LookupError):
        return JsonResponse({"detail": str(exc)}, status=404)
    if isinstance(exc, ValueError):
        return JsonResponse({"detail": str(exc)}, status=400)
    return JsonResponse({"detail": str(exc)}, status=400)


def _submit_success_response(result) -> JsonResponse:
    suffix = "auto_published=1" if result.auto_published else "submitted=1"
    return JsonResponse(
        {
            "ok": True,
            "submitted_count": result.feature_count,
            "auto_published": result.auto_published,
            "published_count": result.published_count,
            "tiles_version": result.tiles_version,
            "errors": result.errors,
            "redirect_url": reverse("success") + "?" + suffix,
        }
    )


def _review_features_qs(layer: Layer):
    return Feature.objects.filter(
        layer=layer, status__in=map_preview_statuses_uploader()
    ).order_by("pk")


@login_required
def upload_view(request):
    denied = enforce_layer_uploader_access(request)
    if denied:
        return denied

    context = {"base_template": resolve_base_template(request.user)}

    if request.method == "POST":
        if "selected" in request.POST:
            request.session["selected"] = request.POST.get("selected")
            return redirect("validate")

        temp_dir = extract_upload_to_temp(request.FILES.getlist("files"))
        detected_shapefiles = collect_detected_shapefiles(temp_dir)
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
    denied = enforce_layer_uploader_access(request)
    if denied:
        return denied

    base_template = resolve_base_template(request.user)
    temp_dir = request.session.get("temp_dir")
    selected = request.session.get("selected")
    if not temp_dir or not selected:
        return render(
            request,
            "layer_uploader/upload.html",
            {
                "base_template": base_template,
                "error": "Session expired. Please upload files again.",
            },
        )

    shp_path = find_shapefile_path(temp_dir, selected)
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
            context["error"] = f"Could not compare this layer to the road network: {exc}"
            return render(request, "layer_uploader/validate.html", context)

        layer = Layer.objects.create(
            name=selected,
            uploaded_by=request.user,
            srid=normalized_epsg,
            total_features=feature_count,
            new_features=len(new_features_data),
            status=Layer.Status.DRAFT,
        )

        Feature.objects.bulk_create(
            [
                Feature(
                    layer=layer,
                    geom=feat["geom"],
                    properties=feat["properties"],
                    uploaded_by=request.user,
                    status=Feature.Status.STAGED,
                )
                for feat in new_features_data
            ]
        )

        return redirect("layer_review", layer_id=layer.pk)

    return render(request, "layer_uploader/validate.html", context)


@login_required
def success_view(request):
    denied = enforce_layer_uploader_access(request)
    if denied:
        return denied
    return render(
        request,
        "layer_uploader/success.html",
        {
            "base_template": resolve_base_template(request.user),
            "map_url": post_upload_map_url(request.user),
            "auto_published": request.GET.get("auto_published") == "1",
            "submitted_to_manager": request.GET.get("submitted") == "1",
        },
    )


@login_required
def review_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    denied = enforce_uploader_review_access(request, layer)
    if denied:
        return denied
    return render(
        request,
        "layer_uploader/review.html",
        review_page_context(request, layer),
    )


@login_required
@require_http_methods(["GET"])
def review_geojson_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()
    return JsonResponse(features_geojson(layer.pk, map_preview_statuses_uploader()))


@login_required
@require_http_methods(["GET"])
def review_table_json_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()
    return JsonResponse(table_payload(layer, _review_features_qs(layer)))


@login_required
@require_http_methods(["POST"])
def review_action_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()

    body = _parse_action_body(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    try:
        payload = apply_uploader_review_action(
            layer,
            body.get("action"),
            feature_id=_parse_feature_id(body),
        )
    except (ValueError, LookupError) as exc:
        return _action_error_response(exc)

    return JsonResponse(payload)


@login_required
@require_http_methods(["POST"])
def submit_layer_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    denied = enforce_uploader_review_access(request, layer)
    if denied:
        return denied

    try:
        result = submit_layer(layer, request.user)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    return _submit_success_response(result)
