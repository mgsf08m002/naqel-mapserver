import json

import fiona
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .access import (
    can_access_manager_review,
    can_access_uploader_review,
    enforce_layer_uploader_access,
    enforce_manager_access,
    enforce_uploader_review_access,
)
from .api import features_geojson, table_payload
from .models import Feature, Layer
from .presentation import post_upload_map_url, resolve_base_template, review_page_context
from .services import (
    approve_and_publish_feature,
    manager_approve_all_awaiting,
    manager_reject_all_awaiting,
    map_preview_statuses_manager,
    map_preview_statuses_uploader,
    reject_feature_by_manager,
    submit_layer,
    tiles_version_ms,
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
    feature_id = body.get("feature_id")
    if feature_id is None:
        return None
    try:
        return int(feature_id)
    except (TypeError, ValueError):
        return None


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


# --- Upload: ZIP/shapefile → local staging DB (default PostGIS) ---


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
            context["error"] = (
                f"Failed to compare uploaded features against Riyadh roads: {exc}"
            )
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


# --- Uploader staging review ---


@login_required
def review_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    denied = enforce_uploader_review_access(request, layer)
    if denied:
        return denied
    return render(
        request,
        "layer_uploader/review.html",
        review_page_context(request, layer, review_mode="uploader"),
    )


@login_required
@require_http_methods(["GET"])
def review_geojson_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()
    payload = features_geojson(layer.pk, map_preview_statuses_uploader())
    return JsonResponse(payload)


@login_required
@require_http_methods(["GET"])
def review_table_json_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()
    features_qs = Feature.objects.filter(
        layer=layer, status__in=map_preview_statuses_uploader()
    ).order_by("pk")
    return JsonResponse(
        table_payload(layer, review_mode="uploader", features_qs=features_qs)
    )


@login_required
@require_http_methods(["POST"])
def review_action_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()

    body = _parse_action_body(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    action = body.get("action")

    if action == "nominate_all":
        updated = layer.features.filter(status=Feature.Status.STAGED).update(
            status=Feature.Status.NOMINATED
        )
        return JsonResponse({"ok": True, "updated": updated})

    if action == "reject_all":
        updated = layer.features.filter(status=Feature.Status.STAGED).update(
            status=Feature.Status.REJECTED_UPLOAD
        )
        return JsonResponse({"ok": True, "updated": updated})

    if action not in ("nominate", "reject"):
        return JsonResponse({"detail": "Unknown action"}, status=400)

    feature_id = _parse_feature_id(body)
    if feature_id is None:
        return JsonResponse({"detail": "Invalid feature_id"}, status=400)

    feature = Feature.objects.filter(pk=feature_id, layer=layer).first()
    if not feature:
        return JsonResponse({"detail": "Feature not found"}, status=404)

    if feature.status != Feature.Status.STAGED:
        return JsonResponse({"detail": "Only staged features can be updated"}, status=400)

    feature.status = (
        Feature.Status.NOMINATED
        if action == "nominate"
        else Feature.Status.REJECTED_UPLOAD
    )
    feature.save(update_fields=["status"])
    return JsonResponse({"ok": True})


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


# --- Manager approval queue → remote riyadh_roads DB ---


@login_required
def manager_queue_view(request):
    denied = enforce_manager_access(request)
    if denied:
        return denied

    queue = (
        Layer.objects.filter(
            status=Layer.Status.SUBMITTED,
            features__status=Feature.Status.AWAITING_MANAGER,
        )
        .distinct()
        .order_by("-submitted_at")
    )
    return render(
        request,
        "layer_uploader/manager_queue.html",
        {
            "base_template": "manager/base.html",
            "queue": queue,
        },
    )


@login_required
def manager_review_view(request, layer_id):
    denied = enforce_manager_access(request)
    if denied:
        return denied

    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_manager_review(layer):
        return redirect("layer_manager_queue")

    return render(
        request,
        "layer_uploader/review.html",
        review_page_context(request, layer, review_mode="manager"),
    )


@login_required
@require_http_methods(["GET"])
def manager_review_geojson_view(request, layer_id):
    denied = enforce_manager_access(request)
    if denied:
        return denied

    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_manager_review(layer):
        return _json_forbidden()

    payload = features_geojson(layer.pk, map_preview_statuses_manager())
    return JsonResponse(payload)


@login_required
@require_http_methods(["GET"])
def manager_review_table_json_view(request, layer_id):
    denied = enforce_manager_access(request)
    if denied:
        return denied

    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_manager_review(layer):
        return _json_forbidden()

    features_qs = Feature.objects.filter(
        layer=layer, status__in=map_preview_statuses_manager()
    ).order_by("pk")
    return JsonResponse(
        table_payload(layer, review_mode="manager", features_qs=features_qs)
    )


def _manager_action_response(layer: Layer, *, published: bool = False) -> JsonResponse:
    layer.refresh_from_db()
    payload = {"ok": True, "layer_completed": layer.status == Layer.Status.COMPLETED}
    if published:
        payload["tiles_version"] = tiles_version_ms()
    return JsonResponse(payload)


@login_required
@require_http_methods(["POST"])
def manager_review_action_view(request, layer_id):
    denied = enforce_manager_access(request)
    if denied:
        return denied

    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_manager_review(layer):
        return _json_forbidden()

    body = _parse_action_body(request)
    if body is None:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    action = body.get("action")

    if action == "approve_all":
        try:
            result = manager_approve_all_awaiting(layer)
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=400)
        return JsonResponse({"ok": True, **result})

    if action == "reject_all":
        result = manager_reject_all_awaiting(layer)
        return JsonResponse({"ok": True, **result})

    if action not in ("approve", "reject"):
        return JsonResponse({"detail": "Unknown action"}, status=400)

    feature_id = _parse_feature_id(body)
    if feature_id is None:
        return JsonResponse({"detail": "Invalid feature_id"}, status=400)

    feature = Feature.objects.filter(
        pk=feature_id, layer=layer, status=Feature.Status.AWAITING_MANAGER
    ).first()
    if not feature:
        return JsonResponse({"detail": "Feature not found"}, status=404)

    if action == "approve":
        try:
            approve_and_publish_feature(feature)
        except Exception as exc:
            return JsonResponse({"detail": str(exc)}, status=400)
        return _manager_action_response(layer, published=True)

    reject_feature_by_manager(feature)
    return _manager_action_response(layer)
