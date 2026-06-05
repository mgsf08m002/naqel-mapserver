"""Layer upload: shapefile staging, uploader review, publish to riyadh_roads."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from django.contrib.auth.models import AbstractBaseUser
from django.contrib.gis.geos import GEOSGeometry

from django.db import connections, transaction
from django.db.models import Count, Max
from django.utils import timezone

from mapping.riyadh_fclass import (
    ensure_riyadh_fclass_in_fields,
    feature_label_from_riyadh_fclass,
)
from mapping.riyadh_network import tiles_version_ms

from .access import is_layer_upload_manager
from .models import Feature, Layer
from .shapefile_properties import (
    _split_bilingual_label,
    coerce_feature_properties,
    pick_shapefile_property,
    resolve_road_name_fields,
)

logger = logging.getLogger(__name__)

RIYADH_CONNECTION = "riyadh_roads"
TARGET_TABLE = "public.riyadh_roads"


def _norm_str(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def properties_to_road_fields(properties: dict[str, Any] | None) -> dict[str, Any]:
    props = coerce_feature_properties(properties)
    names = resolve_road_name_fields(props)
    fclass_raw = pick_shapefile_property(props, "fclass")
    fclass = _norm_str(fclass_raw).lower() if fclass_raw is not None else ""

    fields: dict[str, Any] = {
        "name": names["name"],
        "name_en": names["name_en"],
        "name_ar": names["name_ar"],
        "ref": _norm_str(pick_shapefile_property(props, "ref")),
        "fclass": fclass,
        "oneway": _norm_str(pick_shapefile_property(props, "oneway")),
        "maxspeed": pick_shapefile_property(props, "maxspeed"),
        "osm_id": _norm_str(pick_shapefile_property(props, "osm_id")),
        "code": pick_shapefile_property(props, "code"),
        "bridge": _norm_str(pick_shapefile_property(props, "bridge")),
        "tunnel": _norm_str(pick_shapefile_property(props, "tunnel")),
        "layer": pick_shapefile_property(props, "layer"),
        "road_closure": 0,
    }

    label = feature_label_from_riyadh_fclass(fields["fclass"] or None)
    ensure_riyadh_fclass_in_fields(
        fields,
        current_feature_label=label,
        feature_type=label,
    )
    return fields


def _geometry_to_wgs84_geojson(geom) -> dict:
    g = geom.clone()
    if g.srid and g.srid != 4326:
        g.transform(4326)
    elif not g.srid:
        g.srid = 4326
    return json.loads(g.geojson)


def _validate_line_geometry(geometry_json: dict) -> None:
    if not geometry_json or geometry_json.get("type") not in (
        "LineString",
        "MultiLineString",
    ):
        raise ValueError(
            "Only LineString or MultiLineString features can be published to the road network."
        )
    if not geometry_json.get("coordinates"):
        raise ValueError("Geometry has no coordinates.")


def normalize_geometry_json_for_roads(geometry_json: dict) -> dict:
    """Convert upload geometries to line types accepted by riyadh_roads."""
    if not geometry_json or not geometry_json.get("type"):
        raise ValueError("Missing geometry.")

    gtype = geometry_json.get("type")
    if gtype in ("LineString", "MultiLineString"):
        normalized = geometry_json
    elif gtype in ("Polygon", "MultiPolygon"):
        geom = GEOSGeometry(json.dumps(geometry_json), srid=4326)
        boundary = geom.boundary
        if boundary.empty:
            raise ValueError(
                "Area features must have a boundary; this polygon cannot be published as a road."
            )
        normalized = json.loads(boundary.geojson)
    else:
        raise ValueError(
            f"Unsupported geometry type “{gtype}”. Roads must be lines or polygon boundaries."
        )

    _validate_line_geometry(normalized)
    return normalized


def prepare_road_fields_for_publish(
    *,
    properties: dict[str, Any] | None = None,
    fields_data: dict[str, Any] | None = None,
    current_feature_label: str | None = None,
) -> dict[str, Any]:
    """Build riyadh_roads column values; default fclass so MVT symbology can style new roads."""
    meta_keys = frozenset({"layer_name", "layer_id", "upload_feature_id"})
    if fields_data and isinstance(fields_data, dict):
        fields = {
            k: v
            for k, v in fields_data.items()
            if k not in meta_keys
        }
    else:
        fields = properties_to_road_fields(properties)

    if not _norm_str(fields.get("fclass")):
        fields["fclass"] = "unclassified"

    label = current_feature_label or feature_label_from_riyadh_fclass(
        fields.get("fclass") or None
    )
    ensure_riyadh_fclass_in_fields(
        fields,
        current_feature_label=label,
        feature_type=label,
    )
    return fields


def _insert_road_into_riyadh_roads(
    geometry_json: dict,
    fields: dict[str, Any],
    *,
    road_closure: int = 0,
) -> float:
    """Insert one road row; return the new ``id`` assigned in riyadh_roads."""
    line_geometry = normalize_geometry_json_for_roads(geometry_json)
    name = fields.get("name") or ""
    name_en = _norm_str(fields.get("name_en"))
    name_ar = _norm_str(fields.get("name_ar"))
    if not name_en and not name_ar:
        name_en, name_ar = _split_bilingual_label(name)

    with transaction.atomic(using=RIYADH_CONNECTION):
        from mapping.models import RiyadhRoad

        max_id_val = (
            RiyadhRoad.objects.using(RIYADH_CONNECTION)
            .aggregate(max_id=Max("id"))
            .get("max_id")
        )
        next_id = float(int(max_id_val or 0) + 1)

        with connections[RIYADH_CONNECTION].cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {TARGET_TABLE}
                    (id, geom, name, name_en, name_ar, ref, fclass, oneway, maxspeed,
                     code, bridge, tunnel, layer, road_closure)
                VALUES
                    (
                        %s,
                        ST_Multi(
                            ST_Transform(
                                ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                                3857
                            )
                        ),
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                """,
                [
                    next_id,
                    json.dumps(line_geometry),
                    name,
                    name_en or None,
                    name_ar or None,
                    fields.get("ref") or "",
                    fields.get("fclass") or "",
                    fields.get("oneway") or "",
                    fields.get("maxspeed"),
                    fields.get("code"),
                    fields.get("bridge") or "",
                    fields.get("tunnel") or "",
                    fields.get("layer"),
                    int(road_closure or fields.get("road_closure") or 0),
                ],
            )

    logger.info("Published road to %s id=%s", TARGET_TABLE, next_id)
    return next_id


def publish_geometry_to_riyadh_roads(
    geometry_json: dict,
    *,
    properties: dict[str, Any] | None = None,
    fields_data: dict[str, Any] | None = None,
    current_feature_label: str | None = None,
    road_closure: int = 0,
) -> float:
    fields = prepare_road_fields_for_publish(
        properties=properties,
        fields_data=fields_data,
        current_feature_label=current_feature_label,
    )
    return _insert_road_into_riyadh_roads(
        geometry_json,
        fields,
        road_closure=road_closure,
    )


def publish_feature_to_riyadh_roads(feature: Feature) -> float:
    """Insert a staged feature into remote riyadh_roads; return the new road ``id``."""
    return publish_geometry_to_riyadh_roads(
        _geometry_to_wgs84_geojson(feature.geom),
        properties=feature.properties,
    )


def approve_and_publish_feature(feature: Feature) -> float:
    """Publish to remote DB and remove the local staging row."""
    remote_id = publish_feature_to_riyadh_roads(feature)
    layer = feature.layer
    feature_pk = feature.pk
    feature.delete()
    logger.info("Removed staging feature %s after publish (remote id=%s)", feature_pk, remote_id)
    refresh_layer_completion(layer)
    return remote_id


def publish_feature_list(features) -> tuple[list[float], list[str]]:
    """Publish features; return (remote ids, error messages)."""
    published_ids: list[float] = []
    errors: list[str] = []
    for feature in features:
        try:
            published_ids.append(approve_and_publish_feature(feature))
        except Exception as exc:
            errors.append(str(exc))
    return published_ids, errors


def reject_feature_by_manager(feature: Feature) -> None:
    """Discard a staged upload feature without publishing (manager map reject)."""
    layer = feature.layer
    feature.delete()
    refresh_layer_completion(layer)


def refresh_layer_completion(layer: Layer) -> None:
    if layer.features.exists():
        return
    if layer.status in (Layer.Status.SUBMITTED, Layer.Status.DRAFT):
        layer.status = Layer.Status.COMPLETED
        layer.completed_at = timezone.now()
        layer.save(update_fields=["status", "completed_at"])


@dataclass
class LayerSubmitResult:
    """Outcome of uploader submit (editor → queue, or manager → auto-publish)."""

    feature_count: int
    auto_published: bool = False
    published_count: int = 0
    tiles_version: int | None = None
    errors: list[str] = field(default_factory=list)


def _discard_unnominated_staged_features(layer: Layer) -> None:
    layer.features.filter(status=Feature.Status.STAGED).delete()


def _submit_for_map_review(layer: Layer, nominated) -> LayerSubmitResult:
    """Editor/system admin submit: one approval request per road on the manager map."""
    from .map_review import create_approval_requests_for_layer_upload

    features = list(nominated)
    create_approval_requests_for_layer_upload(layer, features)
    Feature.objects.filter(pk__in=[f.pk for f in features]).update(
        status=Feature.Status.AWAITING_MANAGER
    )
    layer.status = Layer.Status.SUBMITTED
    layer.submitted_at = timezone.now()
    layer.save(update_fields=["status", "submitted_at"])
    return LayerSubmitResult(feature_count=len(features), auto_published=False)


def _auto_publish_manager_self_upload(layer: Layer, nominated) -> LayerSubmitResult:
    """Manager submitter: publish nominated features immediately (skip approval queue)."""
    features = list(nominated)
    published_ids, errors = publish_feature_list(features)

    if errors and not published_ids:
        raise ValueError(errors[0])

    layer.submitted_at = timezone.now()
    # Close out the upload: drop any leftover staged/rejected rows.
    layer.features.all().delete()
    layer.status = Layer.Status.COMPLETED
    layer.completed_at = timezone.now()
    layer.save(update_fields=["status", "submitted_at", "completed_at"])

    return LayerSubmitResult(
        feature_count=len(features),
        auto_published=True,
        published_count=len(published_ids),
        tiles_version=tiles_version_ms() if published_ids else None,
        errors=errors,
    )


def submit_layer(layer: Layer, submitter: AbstractBaseUser) -> LayerSubmitResult:
    """
    Finalize an upload after uploader review.

    - Editor/system admin: nominated features enter the manager approval queue on the map.
    - Manager submitter: nominated features publish straight to riyadh_roads.
    """
    if layer.status != Layer.Status.DRAFT:
        raise ValueError("This layer has already been submitted.")

    nominated = layer.features.filter(status=Feature.Status.NOMINATED)
    count = nominated.count()
    if count == 0:
        raise ValueError("Approve at least one road before submitting.")

    _discard_unnominated_staged_features(layer)

    if is_layer_upload_manager(submitter):
        return _auto_publish_manager_self_upload(layer, nominated)

    return _submit_for_map_review(layer, nominated)


def feature_counts_for_layer(layer: Layer) -> dict[str, int]:
    counts = {
        "total": int(layer.total_features or 0),
        Feature.Status.STAGED: 0,
        Feature.Status.NOMINATED: 0,
        Feature.Status.REJECTED_UPLOAD: 0,
    }
    for row in layer.features.values("status").annotate(c=Count("pk")):
        if row["status"] in counts:
            counts[row["status"]] = row["c"]
    return counts


def map_preview_statuses_uploader() -> list[str]:
    """Statuses shown on the review map and feature table."""
    return [
        Feature.Status.STAGED,
        Feature.Status.NOMINATED,
        Feature.Status.REJECTED_UPLOAD,
    ]


def apply_uploader_review_action(
    layer: Layer,
    action: str,
    *,
    feature_id: int | None = None,
    feature_ids: list[int] | None = None,
) -> dict:
    """API actions: nominate/reject/reset (single), bulk all, or bulk selected."""
    if action == "nominate_all":
        updated = layer.features.filter(status=Feature.Status.STAGED).update(
            status=Feature.Status.NOMINATED
        )
        return {"ok": True, "updated": updated}

    if action == "reject_all":
        updated = layer.features.filter(status=Feature.Status.STAGED).update(
            status=Feature.Status.REJECTED_UPLOAD
        )
        return {"ok": True, "updated": updated}

    if action == "nominate_selected":
        if not feature_ids:
            raise ValueError("feature_ids required")
        updated = layer.features.filter(
            pk__in=feature_ids,
            status=Feature.Status.STAGED,
        ).update(status=Feature.Status.NOMINATED)
        return {"ok": True, "updated": updated}

    if action == "reject_selected":
        if not feature_ids:
            raise ValueError("feature_ids required")
        updated = layer.features.filter(
            pk__in=feature_ids,
            status=Feature.Status.STAGED,
        ).update(status=Feature.Status.REJECTED_UPLOAD)
        return {"ok": True, "updated": updated}

    if action not in ("nominate", "reject", "reset"):
        raise ValueError("Unknown action")

    if feature_id is None:
        raise ValueError("Invalid feature_id")

    feature = Feature.objects.filter(pk=feature_id, layer=layer).first()
    if not feature:
        raise LookupError("Feature not found")

    if action == "reset":
        if feature.status not in (
            Feature.Status.NOMINATED,
            Feature.Status.REJECTED_UPLOAD,
        ):
            raise ValueError("Only approved or rejected features can be reset")
        feature.status = Feature.Status.STAGED
        feature.save(update_fields=["status"])
        return {"ok": True}

    if feature.status != Feature.Status.STAGED:
        raise ValueError("This row cannot be updated")

    feature.status = (
        Feature.Status.NOMINATED
        if action == "nominate"
        else Feature.Status.REJECTED_UPLOAD
    )
    feature.save(update_fields=["status"])
    return {"ok": True}
