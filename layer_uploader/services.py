"""
Layer upload workflow: stage in local PostGIS, manager approval publishes to riyadh_roads.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from django.contrib.auth.models import AbstractBaseUser

from django.db import connections, transaction
from django.db.models import Count, Max
from django.utils import timezone

from mapping.riyadh_fclass import (
    ensure_riyadh_fclass_in_fields,
    feature_label_from_riyadh_fclass,
)

from .access import is_layer_upload_manager
from .models import Feature, Layer

logger = logging.getLogger(__name__)

RIYADH_CONNECTION = "riyadh_roads"
TARGET_TABLE = "public.riyadh_roads"

_PROPERTY_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("name", "NAME", "Name", "road_name", "ROAD_NAME"),
    "ref": ("ref", "REF", "Ref"),
    "fclass": ("fclass", "FCLASS", "highway", "HIGHWAY", "class", "CLASS"),
    "oneway": ("oneway", "ONEWAY", "ONE_WAY"),
    "maxspeed": ("maxspeed", "MAXSPEED", "max_speed"),
    "osm_id": ("osm_id", "OSM_ID", "osmid"),
    "code": ("code", "CODE"),
    "bridge": ("bridge", "BRIDGE"),
    "tunnel": ("tunnel", "TUNNEL"),
    "layer": ("layer", "LAYER", "z_layer", "Z_LAYER"),
}

_FEATURE_COUNT_KEYS = (
    Feature.Status.STAGED,
    Feature.Status.NOMINATED,
    Feature.Status.REJECTED_UPLOAD,
    Feature.Status.AWAITING_MANAGER,
)


def tiles_version_ms() -> int:
    return int(time.time_ns() // 1_000_000)


def _norm_str(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _pick_property(props: dict[str, Any], field: str):
    if not props:
        return None
    for key in _PROPERTY_ALIASES.get(field, (field,)):
        if key in props and props[key] not in (None, ""):
            return props[key]
        lower_map = {str(k).lower(): v for k, v in props.items()}
        if key.lower() in lower_map and lower_map[key.lower()] not in (None, ""):
            return lower_map[key.lower()]
    return None


def properties_to_road_fields(properties: dict[str, Any] | None) -> dict[str, Any]:
    props = properties if isinstance(properties, dict) else {}
    name = _norm_str(_pick_property(props, "name"))
    fclass_raw = _pick_property(props, "fclass")
    fclass = _norm_str(fclass_raw).lower() if fclass_raw is not None else ""

    fields: dict[str, Any] = {
        "name": name,
        "ref": _norm_str(_pick_property(props, "ref")),
        "fclass": fclass,
        "oneway": _norm_str(_pick_property(props, "oneway")),
        "maxspeed": _pick_property(props, "maxspeed"),
        "osm_id": _norm_str(_pick_property(props, "osm_id")),
        "code": _pick_property(props, "code"),
        "bridge": _norm_str(_pick_property(props, "bridge")),
        "tunnel": _norm_str(_pick_property(props, "tunnel")),
        "layer": _pick_property(props, "layer"),
        "road_closure": 0,
    }

    label = feature_label_from_riyadh_fclass(fields["fclass"] or None)
    ensure_riyadh_fclass_in_fields(
        fields,
        current_feature_label=label,
        feature_type=label,
    )
    return fields


def _derive_bilingual_label_values(label_text: str) -> tuple[str, str]:
    raw_label = (label_text or "").strip()
    if not raw_label:
        return "", ""

    arabic = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]")
    latin = re.compile(r"[A-Za-z]")
    has_ar = bool(arabic.search(raw_label))
    has_latin = bool(latin.search(raw_label))

    if has_ar and not has_latin:
        return "", raw_label
    if has_latin and not has_ar:
        return raw_label, ""
    return raw_label, ""


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


def publish_feature_to_riyadh_roads(feature: Feature) -> float:
    """Insert a staged feature into remote riyadh_roads; return the new road ``id``."""
    geometry_json = _geometry_to_wgs84_geojson(feature.geom)
    _validate_line_geometry(geometry_json)

    fields = properties_to_road_fields(feature.properties)
    name = fields.get("name") or ""
    name_en, name_ar = _derive_bilingual_label_values(name)

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
                    json.dumps(geometry_json),
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
                    int(fields.get("road_closure") or 0),
                ],
            )

    logger.info("Published upload feature %s to %s id=%s", feature.pk, TARGET_TABLE, next_id)
    return next_id


def publish_feature_list(features) -> tuple[list[float], list[str]]:
    """Publish a list of staging features; return (remote ids, error messages)."""
    published_ids: list[float] = []
    errors: list[str] = []
    for feature in features:
        try:
            published_ids.append(approve_and_publish_feature(feature))
        except Exception as exc:
            errors.append(str(exc))
    return published_ids, errors


def approve_and_publish_feature(feature: Feature) -> float:
    """Publish to remote DB and remove the local staging row."""
    remote_id = publish_feature_to_riyadh_roads(feature)
    layer = feature.layer
    feature_pk = feature.pk
    feature.delete()
    logger.info("Removed staging feature %s after publish (remote id=%s)", feature_pk, remote_id)
    refresh_layer_completion(layer)
    return remote_id


def reject_feature_by_manager(feature: Feature) -> None:
    """Discard a feature from local staging (not published)."""
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


def _submit_to_manager_queue(layer: Layer, nominated_count: int) -> LayerSubmitResult:
    layer.features.filter(status=Feature.Status.NOMINATED).update(
        status=Feature.Status.AWAITING_MANAGER
    )
    layer.status = Layer.Status.SUBMITTED
    layer.submitted_at = timezone.now()
    layer.save(update_fields=["status", "submitted_at"])
    return LayerSubmitResult(feature_count=nominated_count, auto_published=False)


def manager_approve_all_awaiting(layer: Layer) -> dict:
    """Approve every feature awaiting manager review on this layer."""
    features = list(
        Feature.objects.filter(
            layer=layer, status=Feature.Status.AWAITING_MANAGER
        )
    )
    published_ids, errors = publish_feature_list(features)
    layer.refresh_from_db()
    if errors and not published_ids:
        raise ValueError(errors[0])
    return {
        "published_count": len(published_ids),
        "tiles_version": tiles_version_ms() if published_ids else None,
        "errors": errors,
        "layer_completed": layer.status == Layer.Status.COMPLETED,
    }


def manager_reject_all_awaiting(layer: Layer) -> dict:
    """Reject (discard) every feature awaiting manager review on this layer."""
    features = list(
        Feature.objects.filter(
            layer=layer, status=Feature.Status.AWAITING_MANAGER
        )
    )
    for feature in features:
        reject_feature_by_manager(feature)
    layer.refresh_from_db()
    return {
        "rejected_count": len(features),
        "layer_completed": layer.status == Layer.Status.COMPLETED,
    }


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

    - Editor (or non-manager): nominated features enter the manager approval queue.
    - Manager submitter: nominated features publish straight to riyadh_roads.
    """
    if layer.status != Layer.Status.DRAFT:
        raise ValueError("This upload has already been submitted.")

    nominated = layer.features.filter(status=Feature.Status.NOMINATED)
    count = nominated.count()
    if count == 0:
        raise ValueError(
            "Nominate at least one feature for manager review before submitting."
        )

    _discard_unnominated_staged_features(layer)

    if is_layer_upload_manager(submitter):
        return _auto_publish_manager_self_upload(layer, nominated)

    return _submit_to_manager_queue(layer, count)


def feature_counts_for_layer(layer: Layer) -> dict[str, int]:
    counts = {key: 0 for key in _FEATURE_COUNT_KEYS}
    for row in layer.features.values("status").annotate(c=Count("pk")):
        if row["status"] in counts:
            counts[row["status"]] = row["c"]
    return counts


def map_preview_statuses_uploader() -> list[str]:
    return [Feature.Status.STAGED, Feature.Status.NOMINATED]


def map_preview_statuses_manager() -> list[str]:
    return [Feature.Status.AWAITING_MANAGER]


def pending_upload_approval_count() -> int:
    """Layers in the manager queue (submitted, with at least one feature awaiting review)."""
    return (
        Layer.objects.filter(
            status=Layer.Status.SUBMITTED,
            features__status=Feature.Status.AWAITING_MANAGER,
        )
        .distinct()
        .count()
    )
