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
from .api import (
    feature_detail_dict,
    features_geojson,
    parse_bbox_param,
    parse_list_all_param,
    parse_status_filter,
    parse_table_pagination,
    table_payload,
)
from .constants import BULK_CREATE_BATCH_SIZE, TABLE_PAGE_SIZE_DEFAULT
from .models import Feature, Layer
from .presentation import post_upload_map_url, review_page_context, upload_flow_context
from .services import (
    apply_uploader_review_action,
    map_preview_statuses_uploader,
    submit_layer,
)
from .shapefile_io import collect_detected_shapefiles, extract_upload_to_temp, find_shapefile_path
from .shapefile_properties import coerce_feature_properties
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


def _parse_feature_ids(body) -> list[int] | None:
    raw = body.get("feature_ids")
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError("Invalid feature_ids")
    if not raw:
        raise ValueError("feature_ids required")
    ids: list[int] = []
    for item in raw:
        try:
            ids.append(int(item))
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid feature_ids") from exc
    return ids


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


def _shapefile_details(shp_path: str) -> dict:
    with fiona.open(shp_path) as source:
        crs_name, epsg = simplify_crs(source.crs)
        count = len(source)
    return {
        "count": count,
        "crs_name": crs_name,
        "epsg": epsg if epsg else "Not defined",
    }


def _bulk_create_staged_features(layer: Layer, user, features_data: list) -> None:
    batch: list[Feature] = []
    for feat in features_data:
        batch.append(
            Feature(
                layer=layer,
                geom=feat["geom"],
                properties=coerce_feature_properties(feat.get("properties")),
                uploaded_by=user,
                status=Feature.Status.STAGED,
            )
        )
        if len(batch) >= BULK_CREATE_BATCH_SIZE:
            Feature.objects.bulk_create(batch, batch_size=BULK_CREATE_BATCH_SIZE)
            batch.clear()
    if batch:
        Feature.objects.bulk_create(batch, batch_size=BULK_CREATE_BATCH_SIZE)


def _validate_template_context(request, selected: str, shp_path: str, **extra):
    return upload_flow_context(
        request,
        name=selected,
        **_shapefile_details(shp_path),
        **extra,
    )


@login_required
def upload_view(request):
    denied = enforce_layer_uploader_access(request)
    if denied:
        return denied

    if request.method == "POST":
        if "selected" in request.POST:
            request.session["selected"] = request.POST.get("selected")
            return redirect("validate")

        temp_dir = extract_upload_to_temp(request.FILES.getlist("files"))
        detected_shapefiles = collect_detected_shapefiles(temp_dir)
        if not detected_shapefiles:
            return render(
                request,
                "layer_uploader/upload.html",
                upload_flow_context(request, error="No valid shapefile found."),
            )

        request.session["temp_dir"] = temp_dir

        selectable = [s for s in detected_shapefiles if s.get("name") and not s.get("error")]
        if len(selectable) == 1:
            request.session["selected"] = selectable[0]["name"]
            return redirect("validate")

        return render(
            request,
            "layer_uploader/upload.html",
            upload_flow_context(request, shapefiles=detected_shapefiles),
        )

    return render(request, "layer_uploader/upload.html", upload_flow_context(request))


@login_required
def validate_view(request):
    denied = enforce_layer_uploader_access(request)
    if denied:
        return denied

    temp_dir = request.session.get("temp_dir")
    selected = request.session.get("selected")
    if not temp_dir or not selected:
        return render(
            request,
            "layer_uploader/upload.html",
            upload_flow_context(
                request,
                error="Session expired. Please upload files again.",
            ),
        )

    shp_path = find_shapefile_path(temp_dir, selected)
    if not shp_path:
        return render(
            request,
            "layer_uploader/upload.html",
            upload_flow_context(request, error="Shapefile not found."),
        )

    details = _shapefile_details(shp_path)
    normalized_epsg = coerce_epsg(details["epsg"])

    if request.method == "POST":
        try:
            new_features_data = find_new_features_against_riyadh_roads(shp_path)
        except Exception as exc:
            return render(
                request,
                "layer_uploader/validate.html",
                _validate_template_context(
                    request,
                    selected,
                    shp_path,
                    error=f"Could not compare this layer to the road network: {exc}",
                ),
            )

        layer = Layer.objects.create(
            name=selected,
            uploaded_by=request.user,
            srid=normalized_epsg,
            total_features=details["count"],
            new_features=len(new_features_data),
            status=Layer.Status.DRAFT,
        )

        _bulk_create_staged_features(layer, request.user, new_features_data)

        return redirect("layer_review", layer_id=layer.pk)

    return render(
        request,
        "layer_uploader/validate.html",
        _validate_template_context(request, selected, shp_path),
    )


@login_required
def success_view(request):
    denied = enforce_layer_uploader_access(request)
    if denied:
        return denied
    return render(
        request,
        "layer_uploader/success.html",
        upload_flow_context(
            request,
            map_url=post_upload_map_url(request.user),
            auto_published=request.GET.get("auto_published") == "1",
            submitted_to_manager=request.GET.get("submitted") == "1",
        ),
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
    bbox = parse_bbox_param(request.GET.get("bbox"))
    payload = features_geojson(
        layer.pk,
        map_preview_statuses_uploader(),
        bbox=bbox,
    )
    return JsonResponse(payload)


@login_required
@require_http_methods(["GET"])
def review_table_json_view(request, layer_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()
    list_all = parse_list_all_param(request.GET.get("list"))
    page, page_size = parse_table_pagination(
        request.GET.get("page"),
        request.GET.get("page_size"),
        default_page_size=TABLE_PAGE_SIZE_DEFAULT,
    )
    status_filter = parse_status_filter(
        request.GET.get("status"),
        map_preview_statuses_uploader(),
    )
    try:
        payload = table_payload(
            layer,
            _review_features_qs(layer),
            page=page,
            page_size=page_size,
            status_filter=status_filter,
            list_all=list_all,
        )
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    return JsonResponse(payload)


@login_required
@require_http_methods(["GET"])
def review_feature_json_view(request, layer_id, feature_id):
    layer = get_object_or_404(Layer, pk=layer_id)
    if not can_access_uploader_review(request.user, layer):
        return _json_forbidden()
    feature = get_object_or_404(
        Feature,
        pk=feature_id,
        layer=layer,
        status__in=map_preview_statuses_uploader(),
    )
    return JsonResponse(feature_detail_dict(feature))


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
            feature_ids=_parse_feature_ids(body),
        )
    except ValueError as exc:
        return _action_error_response(exc)
    except LookupError as exc:
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
