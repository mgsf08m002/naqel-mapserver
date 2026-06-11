from django.shortcuts import get_object_or_404
from django.http import JsonResponse, Http404, HttpResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.contrib.gis.geos import GEOSGeometry, Polygon, MultiLineString, LineString
from django.db import transaction, connections
from django.db.models import Q
from django.conf import settings
from decimal import Decimal
import json
import logging
import math
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from layer_uploader.map_review import (
    approve_layer_upload_edit_request,
    reject_layer_upload_edit_request,
)
from layer_uploader.services import (
    prepare_road_fields_for_publish,
    publish_geometry_to_riyadh_roads,
)

from .approval_api import (
    EDIT_LIST_LIMIT,
    serialize_approval_request_detail,
    serialize_approval_request_list_item,
    serialize_edit_request_list,
    serialize_manager_review_history_item,
    serialize_my_edit_request_item,
)
from .edit_list_query import (
    apply_my_edits_filters,
    apply_review_history_filters,
    filter_editor_submissions,
    parse_review_history_scope,
)
from .presentation import has_my_edits_access, user_edits_apply_immediately, user_is_manager
from .approval_categories import (
    EDIT_TYPE_DELETE,
    create_pending_road_edit_request,
    is_delete_road_request,
    is_layer_upload_request,
)
from .models import LineEditRequest, RiyadhRoad
from .riyadh_fclass import (
    apply_riyadh_fclass_from_feature_label,
    ensure_riyadh_fclass_in_fields,
    feature_label_from_riyadh_fclass,
)
from .riyadh_fields import (
    RIYADH_FIELDS_NON_REVIEWABLE,
    RIYADH_FIELDS_OMIT_FROM_TAGS,
    RIYADH_FIELDS_UI_ONLY,
    RIYADH_SIDEBAR_EXCLUSIVE_FIELD_KEYS,
    riyadh_decimal_eq,
)
from .riyadh_network import (
    network_mutation_payload,
    normalize_published_fclass,
    publish_riyadh_tiles_version,
    published_fclass_from_edit_request,
    riyadh_map_sync_payload,
)

logger = logging.getLogger(__name__)

RIYADH_REMOTE_FIELD_KEYS = frozenset(
    {
        "name",
        "ref",
        "fclass",
        "oneway",
        "maxspeed",
        "osm_id",
        "code",
        "bridge",
        "tunnel",
        "layer",
        "shape_length",
        "road_closure",
    }
)
# save_line_edit_request: sidebar must not use the generic default "Line" placeholder.
FEATURE_TYPE_REQUIRED_FOR_SAVE_MSG = "Select a feature type for your road"
ARABIC_CHAR_PATTERN = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]")
LATIN_CHAR_PATTERN = re.compile(r"[A-Za-z]")


def _detect_road_label_language(label_text: str) -> str:
    """
    Detect whether a free-text road label is Arabic or English.
    Returns: 'ar', 'en', or 'unknown'.
    """
    text = (label_text or "").strip()
    if not text:
        return "unknown"

    has_ar = bool(ARABIC_CHAR_PATTERN.search(text))
    has_latin = bool(LATIN_CHAR_PATTERN.search(text))

    if has_ar and not has_latin:
        return "ar"
    if has_latin and not has_ar:
        return "en"
    return "unknown"


def _derive_bilingual_label_values(label_text: str):
    """
    Map the single editor Road Label field to (name_en, name_ar).

    The UI has one authoritative name per save. The opposite language column is
    cleared so a rename does not leave a stale label visible on the other
    language layer.
    """
    raw_label = (label_text or "").strip()
    if not raw_label:
        return "", ""

    lang = _detect_road_label_language(raw_label)
    if lang == "ar":
        return "", raw_label
    if lang == "en":
        return raw_label, ""
    # Mixed or unknown script: store once in name_en; clear name_ar to avoid duplicates.
    return raw_label, ""


def _get_riyadh_road_bilingual_names_by_gid(gid_value):
    """Fetch (name_en, name_ar) directly from remote DB by gid."""
    if gid_value is None:
        return "", ""
    with connections["riyadh_roads"].cursor() as cursor:
        cursor.execute(
            """
            SELECT
                COALESCE(NULLIF(TRIM(name_en), ''), '') AS name_en,
                COALESCE(NULLIF(TRIM(name_ar), ''), '') AS name_ar
            FROM public.riyadh_roads
            WHERE gid = %s
            LIMIT 1
            """,
            [int(gid_value)],
        )
        row = cursor.fetchone()
    if not row:
        return "", ""
    return (row[0] or "").strip(), (row[1] or "").strip()


RIYADH_ROAD_SEARCH_MIN_QUERY_LEN = 2
RIYADH_ROAD_SEARCH_DEFAULT_LIMIT = 12
RIYADH_ROAD_SEARCH_MAX_LIMIT = 20


def _riyadh_road_display_name(name_en, name_ar, name=""):
    """Preferred label for search results and UI (EN, then AR, then legacy name)."""
    return (
        (name_en or "").strip()
        or (name_ar or "").strip()
        or (name or "").strip()
        or "Unnamed road"
    )


def _parse_riyadh_road_geometry_geojson(geometry_geojson):
    if not geometry_geojson:
        return None
    try:
        geometry = json.loads(geometry_geojson)
    except Exception:
        return None
    return geometry if isinstance(geometry, dict) else None


def _persist_riyadh_road_label_columns(road, label_text):
    """
    Persist editor Road Label to remote bilingual columns.
    - English input updates name_en
    - Arabic input updates name_ar
    - Unknown/mixed input falls back to name_en
    - Empty input clears name, name_en, and name_ar so map labels disappear
    Also keeps `name` aligned for legacy consumers.
    """
    if not road:
        return

    gid_value = getattr(road, "gid", None)
    if gid_value is None:
        return

    raw_label = (label_text or "").strip()
    if not raw_label:
        with connections["riyadh_roads"].cursor() as cursor:
            cursor.execute(
                """
                UPDATE public.riyadh_roads
                SET
                    name = '',
                    name_en = NULL,
                    name_ar = NULL
                WHERE gid = %s
                """,
                [int(gid_value)],
            )
        return

    next_en, next_ar = _derive_bilingual_label_values(raw_label)

    with connections["riyadh_roads"].cursor() as cursor:
        cursor.execute(
            """
            UPDATE public.riyadh_roads
            SET
                name = %s,
                name_en = %s,
                name_ar = %s
            WHERE gid = %s
            """,
            [raw_label, next_en or None, next_ar or None, int(gid_value)],
        )


@require_http_methods(["GET"])
def riyadh_roads_map_sync(request):
    """
    Public sync endpoint for companion map apps (naqel-map / GEOTRAK).

    Returns global tiles_version (bumps on every riyadh_roads edit) and
    symbology_version (symbology.json / labeling.json changes).
    """
    response = JsonResponse(riyadh_map_sync_payload())
    response["Cache-Control"] = "no-store, max-age=0"
    response["Access-Control-Allow-Origin"] = "*"
    return response


@require_http_methods(["GET"])
def riyadh_roads_tile_proxy(request, z: int, x: int, y: int):
    """Proxy Riyadh roads MVT tiles (Martin → PostGIS). No-store by default; client busts with ?v=."""
    upstream_template = getattr(settings, "RIYADH_ROADS_TILE_URL", "").strip()
    if not upstream_template:
        raise Http404("Upstream tile service is not configured.")

    try:
        upstream_url = upstream_template.format(z=int(z), x=int(x), y=int(y))
    except Exception:
        raise Http404("Invalid upstream tile URL template.")

    if request.GET:
        upstream_url = f"{upstream_url}?{urlencode(request.GET, doseq=True)}"

    req = Request(
        upstream_url,
        headers={
            "User-Agent": "naqel-mapserver/1.0",
            "Cache-Control": "no-cache, no-store",
            "Pragma": "no-cache",
        },
    )
    try:
        timeout_seconds = max(
            1,
            int(getattr(settings, "RIYADH_ROADS_TILE_PROXY_TIMEOUT_SECONDS", 20)),
        )
        with urlopen(req, timeout=timeout_seconds) as resp:
            body = resp.read()
            content_type = resp.headers.get("Content-Type") or "application/octet-stream"
            upstream_status = int(getattr(resp, "status", 200) or 200)
            # Martin uses 204 for empty tiles; pass it through so clients drop stale geometry.
            out_status = upstream_status if upstream_status in (200, 204) else 200

            out = HttpResponse(body, content_type=content_type, status=out_status)
            cache_max_age = max(
                0,
                int(getattr(settings, "RIYADH_ROADS_TILE_PROXY_CACHE_MAX_AGE", 0)),
            )
            if cache_max_age == 0:
                out["Cache-Control"] = "no-store, max-age=0"
            elif out_status == 204 or not body:
                out["Cache-Control"] = "no-store, max-age=0"
            else:
                out["Cache-Control"] = f"public, max-age={cache_max_age}"
            out["Vary"] = "Accept-Encoding"
            return out
    except HTTPError as exc:
        status = int(getattr(exc, "code", 502) or 502)
        if status == 404:
            raise Http404("Tile not found.")
        logger.warning("Tile proxy upstream HTTP error %s for %s", status, upstream_url)
        return HttpResponse(status=status)
    except URLError as exc:
        logger.warning("Tile proxy upstream network error for %s: %s", upstream_url, exc)
        return HttpResponse(status=502)
    except Exception as exc:
        logger.warning("Tile proxy failed for %s: %s", upstream_url, exc)
        return HttpResponse(status=502)


@require_http_methods(["GET"])
def riyadh_road_labels(request):
    """
    Return bilingual road labels (name_en/name_ar) from the remote riyadh_roads DB.

    This endpoint is intentionally decoupled from vector-tile properties so label
    rendering always reflects DB truth even when tile schemas differ.
    """
    bbox_raw = (request.GET.get("bbox") or "").strip()
    if not bbox_raw:
        return JsonResponse({"success": False, "message": "Missing bbox query parameter."}, status=400)

    try:
        west, south, east, north = [float(x) for x in bbox_raw.split(",")]
    except Exception:
        return JsonResponse({"success": False, "message": "Invalid bbox format."}, status=400)

    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        return JsonResponse({"success": False, "message": "Invalid bbox values."}, status=400)

    if east <= west or north <= south:
        return JsonResponse({"success": False, "message": "Invalid bbox extent."}, status=400)

    try:
        limit = int(request.GET.get("limit", "1800"))
    except Exception:
        limit = 1800
    limit = max(100, min(limit, 4000))

    sql = """
        SELECT
            CAST(id AS BIGINT) AS road_id,
            NULLIF(TRIM(name_en), '') AS name_en,
            NULLIF(TRIM(name_ar), '') AS name_ar,
            ST_AsGeoJSON(
                ST_Transform(
                    ST_LineMerge(geom),
                    4326
                )
            ) AS geometry_geojson
        FROM public.riyadh_roads
        WHERE
            geom && ST_Transform(ST_MakeEnvelope(%s, %s, %s, %s, 4326), 3857)
            AND ST_Intersects(geom, ST_Transform(ST_MakeEnvelope(%s, %s, %s, %s, 4326), 3857))
            AND (COALESCE(name_en, '') <> '' OR COALESCE(name_ar, '') <> '')
        LIMIT %s
    """

    features = []
    try:
        with connections["riyadh_roads"].cursor() as cursor:
            cursor.execute(
                sql,
                [west, south, east, north, west, south, east, north, limit],
            )
            rows = cursor.fetchall()

        for road_id, name_en, name_ar, geometry_geojson in rows:
            if not geometry_geojson:
                continue
            try:
                geometry = json.loads(geometry_geojson)
            except Exception:
                continue
            features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {
                        "id": int(road_id) if road_id is not None else None,
                        "name_en": name_en or "",
                        "name_ar": name_ar or "",
                    },
                }
            )
    except Exception as exc:
        logger.warning("Failed loading Riyadh road labels from DB: %s", exc)
        return JsonResponse({"success": False, "message": "Failed to load road labels."}, status=500)

    return JsonResponse(
        {
            "success": True,
            "type": "FeatureCollection",
            "features": features,
        }
    )


@login_required
@require_http_methods(["GET"])
def riyadh_road_search(request):
    """
    Find Riyadh roads by English (name_en / name) or Arabic (name_ar) labels.
    Returns tile network id, display names, and WGS84 geometry for map zoom.
    """
    query = (request.GET.get("q") or "").strip()
    if len(query) < RIYADH_ROAD_SEARCH_MIN_QUERY_LEN:
        return JsonResponse(
            {
                "success": False,
                "message": (
                    f"Enter at least {RIYADH_ROAD_SEARCH_MIN_QUERY_LEN} characters to search."
                ),
                "results": [],
            },
            status=400,
        )

    try:
        limit = int(request.GET.get("limit", str(RIYADH_ROAD_SEARCH_DEFAULT_LIMIT)))
    except (TypeError, ValueError):
        limit = RIYADH_ROAD_SEARCH_DEFAULT_LIMIT
    limit = max(1, min(limit, RIYADH_ROAD_SEARCH_MAX_LIMIT))

    pattern = f"%{query}%"
    prefix = f"{query}%"
    query_lower = query.lower()

    sql = """
        SELECT
            CAST(id AS BIGINT) AS road_id,
            COALESCE(NULLIF(TRIM(name_en), ''), '') AS name_en,
            COALESCE(NULLIF(TRIM(name_ar), ''), '') AS name_ar,
            COALESCE(NULLIF(TRIM(name), ''), '') AS name,
            ST_AsGeoJSON(
                ST_Transform(ST_LineMerge(geom), 4326)
            ) AS geometry_geojson,
            CASE
                WHEN LOWER(COALESCE(name_en, '')) = %s THEN 0
                WHEN LOWER(COALESCE(name_ar, '')) = %s THEN 0
                WHEN LOWER(COALESCE(name, '')) = %s THEN 0
                WHEN COALESCE(name_en, '') ILIKE %s THEN 1
                WHEN COALESCE(name_ar, '') ILIKE %s THEN 1
                WHEN COALESCE(name, '') ILIKE %s THEN 1
                ELSE 2
            END AS rank_key
        FROM public.riyadh_roads
        WHERE
            COALESCE(name_en, '') ILIKE %s
            OR COALESCE(name_ar, '') ILIKE %s
            OR COALESCE(name, '') ILIKE %s
        ORDER BY rank_key,
            length(COALESCE(NULLIF(TRIM(name_en), ''), NULLIF(TRIM(name_ar), ''), name, ''))
        LIMIT %s
    """

    params = [
        query_lower,
        query_lower,
        query_lower,
        prefix,
        prefix,
        prefix,
        pattern,
        pattern,
        pattern,
        limit,
    ]

    results = []
    try:
        with connections["riyadh_roads"].cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()

        for road_id, name_en, name_ar, name, geometry_geojson, _rank in rows:
            geometry = _parse_riyadh_road_geometry_geojson(geometry_geojson)
            if road_id is None or geometry is None:
                continue
            results.append(
                {
                    "id": int(road_id),
                    "name_en": name_en or "",
                    "name_ar": name_ar or "",
                    "display_name": _riyadh_road_display_name(name_en, name_ar, name),
                    "geometry": geometry,
                }
            )
    except Exception as exc:
        logger.warning("Riyadh road search failed: %s", exc)
        return JsonResponse(
            {"success": False, "message": "Search is temporarily unavailable.", "results": []},
            status=500,
        )

    return JsonResponse({"success": True, "results": results})


def _geometry_looks_like_wgs84(geometry):
    """Return True when a GeoJSON geometry already appears to be in WGS84."""
    try:
        if not geometry or not isinstance(geometry, dict):
            return False

        geom_type = geometry.get("type")
        coords = geometry.get("coordinates")
        if not coords:
            return False

        def _iter_points(values):
            if not isinstance(values, (list, tuple)):
                return

            # Coordinate pair: [x, y] (or [x, y, z])
            if values and isinstance(values[0], (int, float, str)):
                if len(values) >= 2:
                    yield values
                return

            for child in values:
                for pt in _iter_points(child):
                    yield pt

        seen = 0
        for pt in _iter_points(coords):
            if not pt or not isinstance(pt, (list, tuple)) or len(pt) < 2:
                continue
            try:
                lng = float(pt[0])
                lat = float(pt[1])
            except (TypeError, ValueError):
                return False

            if not (-180.0 <= lng <= 180.0 and -90.0 <= lat <= 90.0):
                return False

            seen += 1
            if seen >= 1000:
                break

        # If we couldn't validate any coordinates, assume it's NOT WGS84 so we
        # transform it.
        return seen > 0
    except Exception:
        # Never treat an error as "already WGS84" — in doubt, transform.
        return False


def _ensure_wgs84_geometry(geometry, source_srid=3857):
    """Normalize a GeoJSON geometry to WGS84 when it looks projected."""
    if not geometry:
        return geometry

    if _geometry_looks_like_wgs84(geometry):
        return geometry

    try:
        # GeoJSON carries no SRID by default. Django/GEOS commonly assumes 4326,
        # which is wrong for our stored road network geometries (3857). So we:
        # - parse without forcing SRID
        # - explicitly set the expected source SRID
        # - then transform to 4326
        geom = GEOSGeometry(json.dumps(geometry))
        try:
            geom.srid = int(source_srid)
        except Exception:
            pass
        geom.transform(4326)
        return json.loads(geom.json)
    except Exception:
        return geometry


def _resolve_riyadh_road(road_identifier):
    """
    Resolve a RiyadhRoad for an identifier coming from the map.

    Important: our vector-tile source uses `promoteId: { riyadh_roads: 'id' }`
    (see mapping/static/mapping/js/map.js). That means the feature identifier
    used by the browser is the DB column `id`, not the primary key `gid`.

    Because `gid` and `id` can overlap across different rows, we must try the
    `id` column first, and only fall back to `gid` when there is no `id` match.
    """
    if road_identifier is None:
        return None
    identifier = int(road_identifier)
    try:
        return RiyadhRoad.objects.using("riyadh_roads").get(id=float(identifier))
    except RiyadhRoad.DoesNotExist:
        try:
            return RiyadhRoad.objects.using("riyadh_roads").get(gid=identifier)
        except RiyadhRoad.DoesNotExist:
            return None


def _get_riyadh_road_geometry_wgs84(road_identifier):
    """Fetch a RiyadhRoad geometry and return it in WGS84 GeoJSON."""
    if road_identifier is None:
        return None

    try:
        road = _resolve_riyadh_road(road_identifier)
        if not road:
            return None

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


def _geometries_equivalent_wgs84(geom_a, geom_b) -> bool:
    """Compare two GeoJSON geometries in WGS84 using GEOS equality after normalization."""
    if geom_a is None and geom_b is None:
        return True
    if geom_a is None or geom_b is None:
        return False

    def _extract_primary_line_coords(geometry):
        if not isinstance(geometry, dict):
            return None
        gtype = geometry.get("type")
        coords = geometry.get("coordinates")

        if gtype == "LineString":
            if isinstance(coords, list) and len(coords) >= 2:
                return coords
            return None

        if gtype == "MultiLineString":
            if not isinstance(coords, list):
                return None
            for part in coords:
                if isinstance(part, list) and len(part) >= 2:
                    return part
            return None

        if gtype == "GeometryCollection":
            geoms = geometry.get("geometries") or []
            if isinstance(geoms, list):
                for child in geoms:
                    found = _extract_primary_line_coords(child)
                    if found:
                        return found
            return None

        return None

    def _coords_match_with_tolerance(a_coords, b_coords, tol=1e-5):
        if not isinstance(a_coords, list) or not isinstance(b_coords, list):
            return False
        if len(a_coords) != len(b_coords):
            return False
        for idx in range(len(a_coords)):
            pa = a_coords[idx]
            pb = b_coords[idx]
            if not isinstance(pa, (list, tuple)) or not isinstance(pb, (list, tuple)):
                return False
            if len(pa) < 2 or len(pb) < 2:
                return False
            try:
                ax = float(pa[0])
                ay = float(pa[1])
                bx = float(pb[0])
                by = float(pb[1])
            except (TypeError, ValueError):
                return False
            if abs(ax - bx) > tol or abs(ay - by) > tol:
                return False
        return True

    try:
        g1 = GEOSGeometry(json.dumps(geom_a), srid=4326)
        g2 = GEOSGeometry(json.dumps(geom_b), srid=4326)
        if g1.equals(g2):
            return True
    except Exception:
        pass

    # Fallback for representational drift (e.g., LineString vs single-part
    # MultiLineString with identical coordinates) that can occur in client/server
    # round-trips without a real geometry edit.
    a_line = _extract_primary_line_coords(geom_a)
    b_line = _extract_primary_line_coords(geom_b)
    if not a_line or not b_line:
        return False
    if _coords_match_with_tolerance(a_line, b_line):
        return True
    return _coords_match_with_tolerance(a_line, list(reversed(b_line)))


def _validate_line_geojson_for_edit(geometry) -> None:
    """
    Ensure geometry is suitable for a road geometry edit.
    Raises ValueError with a user-safe message if invalid.
    """
    if not geometry or not isinstance(geometry, dict):
        raise ValueError("Invalid geometry payload.")

    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")

    if geom_type == "LineString":
        line_coords = coords
    elif geom_type == "MultiLineString":
        if not isinstance(coords, list) or not coords:
            raise ValueError("MultiLineString must contain at least one line.")
        line_coords = None
        for part in coords:
            if isinstance(part, list) and len(part) >= 2:
                line_coords = part
                break
        if line_coords is None:
            raise ValueError("MultiLineString has no segment with enough points.")
    else:
        raise ValueError("Geometry-type must be LineString or MultiLineString.")

    if not isinstance(line_coords, list) or len(line_coords) < 2:
        raise ValueError("A road line must have at least two vertices.")

    try:
        g = GEOSGeometry(json.dumps(geometry), srid=4326)
        g.transform(3857)
    except Exception as exc:
        logger.warning("GEOS parse/transform failed for edit geometry: %s", exc)
        raise ValueError("Geometry could not be parsed or projected for storage.") from exc

    if geom_type == "LineString" and len(line_coords) >= 2:
        if line_coords[0] == line_coords[-1] and len(line_coords) < 3:
            raise ValueError("Degenerate road geometry.")


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def save_line_edit_request(request):
    """
    Save a road edit (submit to approval queue or apply immediately).

    Rejects the generic placeholder feature type ``Line``; a real ``current_feature_label`` is required.

    Managers and system admins: apply immediately to the remote network.

    Editors: submit to the manager approval queue when review is required.

    All roles: Riyadh ``road_closure`` changes apply immediately on the remote DB
    (no manager approval). Approval-queue rows are created only when geometry,
    relations, extra fields, or other attribute drift still require review.
    """
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

        applies_immediately = user_edits_apply_immediately(request.user)

        # Normalize road closure and Riyadh road metadata from payload
        raw_road_closure = data.get("road_closure", 0)
        try:
            road_closure = int(raw_road_closure)
        except (TypeError, ValueError):
            road_closure = 0
        road_closure = 1 if road_closure == 1 else 0

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

        try:
            _validate_line_geojson_for_edit(normalized_geometry)
        except ValueError as ve:
            return JsonResponse(
                {
                    "success": False,
                    "message": str(ve),
                },
                status=400,
            )

        fields_data = data.get("fields_data") or {}
        tags_data = data.get("tags_data") or []
        relations_data = data.get("relations_data") or []

        feature_label = str(
            data.get("current_feature_label") or data.get("feature_type") or ""
        ).strip()
        fields_data = apply_riyadh_fclass_from_feature_label(
            fields_data,
            current_feature_label=feature_label,
            feature_type=feature_label,
        )
        if not feature_label or feature_label.lower() == "line":
            return JsonResponse(
                {
                    "success": False,
                    "message": FEATURE_TYPE_REQUIRED_FOR_SAVE_MSG,
                },
                status=400,
            )

        original_geometry = None
        geometry_changed = False
        road = None
        if is_riyadh_road and riyadh_road_id_int is not None:
            road = _resolve_riyadh_road(riyadh_road_id_int)
            if not road:
                return JsonResponse(
                    {
                        "success": False,
                        "message": "Riyadh road not found after update.",
                    },
                    status=404,
                )

            # Derive closure drift from DB truth so closure-only saves remain
            # correct even when the client-side `closure_changed` flag is stale.
            try:
                current_db_closure = int(getattr(road, "road_closure", 0) or 0)
            except (TypeError, ValueError):
                current_db_closure = 0
            current_db_closure = 1 if current_db_closure == 1 else 0
            closure_changed = bool(closure_changed or (current_db_closure != road_closure))

            original_geometry = _get_riyadh_road_geometry_wgs84(riyadh_road_id_int)
            if original_geometry is None:
                return JsonResponse(
                    {
                        "success": False,
                        "message": "Could not load original road geometry for this feature.",
                    },
                    status=404,
                )
            geometry_changed = not _geometries_equivalent_wgs84(
                original_geometry, normalized_geometry
            )

        closure_tiles_version = None
        if is_riyadh_road and riyadh_road_id_int is not None and closure_changed:
            try:
                _apply_riyadh_road_closure_remote(riyadh_road_id_int, road_closure)
                if road:
                    road.refresh_from_db(using="riyadh_roads")
                closure_tiles_version = publish_riyadh_tiles_version()
            except Exception as e:
                logger.warning("Immediate road closure update failed: %s", e)
                return JsonResponse(
                    {
                        "success": False,
                        "message": f"Could not update road closure on the network: {str(e)}",
                    },
                    status=500,
                )

        if is_riyadh_road and road:
            fields_data = dict(fields_data)
            fields_data["_original_feature_label"] = feature_label_from_riyadh_fclass(
                getattr(road, "fclass", None)
            )
            fields_data["_original_road_name"] = getattr(road, "name", "") or ""

        edit_request_create_kwargs = {
            "requester": request.user,
            "geometry": normalized_geometry,
            "original_geometry": original_geometry,
            "geometry_changed": geometry_changed,
            "feature_type": feature_label,
            "current_feature_label": feature_label,
            "fields_data": fields_data,
            "tags_data": tags_data,
            "relations_data": relations_data,
            "road_closure": road_closure,
            "is_riyadh_road": is_riyadh_road,
            "riyadh_road_id": riyadh_road_id_int,
        }

        if applies_immediately:
            edit_request = create_pending_road_edit_request(
                road=road, **edit_request_create_kwargs
            )
            created_request_id = edit_request.id
            remote_road_id = None
            published_fclass = None
            try:
                if is_delete_road_request(edit_request):
                    _apply_delete_to_base_network(edit_request)
                elif edit_request.is_riyadh_road:
                    _apply_riyadh_edit_to_base_network(edit_request)
                    remote_road_id = edit_request.riyadh_road_id
                    published_fclass = published_fclass_from_edit_request(edit_request)
                else:
                    remote_road_id, published_fclass = (
                        _publish_manual_new_road_from_edit_request(edit_request)
                    )
                _set_published_road_id_after_approval(
                    edit_request, remote_road_id=remote_road_id
                )
                edit_request.approve(request.user)
            except Exception as e:
                try:
                    edit_request.delete()
                except Exception:
                    pass
                return JsonResponse(
                    {
                        "success": False,
                        "message": f"Failed to apply approved edit to remote network: {str(e)}",
                    },
                    status=500,
                )

            return JsonResponse(
                {
                    "success": True,
                    "message": "Your edit was applied to the live road network.",
                    "request_id": created_request_id,
                    "auto_approved": True,
                    "pending_submitted": False,
                    "closure_applied": bool(closure_changed),
                    "road_closure": road_closure,
                    **network_mutation_payload(
                        remote_road_id=remote_road_id,
                        fclass=published_fclass,
                    ),
                }
            )

        if not is_riyadh_road:
            edit_request = create_pending_road_edit_request(
                road=None, **edit_request_create_kwargs
            )
            return JsonResponse(
                {
                    "success": True,
                    "message": "Your road edit has been submitted for manager review.",
                    "request_id": edit_request.id,
                    "auto_approved": False,
                    "pending_submitted": True,
                    "closure_applied": False,
                    "road_closure": road_closure,
                    "tiles_version": None,
                }
            )

        if not road:
            road = _resolve_riyadh_road(riyadh_road_id_int)
            if not road:
                return JsonResponse(
                    {
                        "success": False,
                        "message": "Riyadh road not found after update.",
                    },
                    status=404,
                )

        needs_review = _riyadh_needs_manager_review(
            fields_data,
            tags_data,
            relations_data,
            road,
            geometry_changed,
            closure_changed,
        )
        if not needs_review:
            return JsonResponse(
                {
                    "success": True,
                    "message": "Road closure and attributes are up to date. Nothing else requires review.",
                    "auto_approved": False,
                    "pending_submitted": False,
                    "closure_applied": bool(closure_changed),
                    "road_closure": road_closure,
                    "tiles_version": closure_tiles_version,
                }
            )

        edit_request = create_pending_road_edit_request(
            road=road, **edit_request_create_kwargs
        )

        pending_message = "Your edit has been submitted for manager review."
        if closure_changed:
            pending_message += " Road closure is already live if you changed it."

        return JsonResponse(
            {
                "success": True,
                "message": pending_message,
                "request_id": edit_request.id,
                "auto_approved": False,
                "pending_submitted": True,
                "closure_applied": bool(closure_changed),
                "road_closure": road_closure,
                "tiles_version": closure_tiles_version,
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
    fields = apply_riyadh_fclass_from_feature_label(
        edit_request.fields_data or {},
        current_feature_label=edit_request.current_feature_label,
        feature_type=edit_request.feature_type,
    )
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

    geometry_json = edit_request.geometry
    geom = None
    if geometry_json:
        try:
            _validate_line_geojson_for_edit(
                _ensure_wgs84_geometry(geometry_json, source_srid=3857)
            )
        except ValueError as exc:
            logger.warning("Rejected invalid geometry on apply: %s", exc)
            raise
        geom = GEOSGeometry(json.dumps(geometry_json), srid=4326)
        try:
            geom.transform(3857)
        except Exception:
            geom = None

        # RiyadhRoad.geom is a MultiLineStringField; ensure the GEOS geometry
        # we assign matches that type to avoid SpatialProxy type errors.
        if isinstance(geom, LineString):
            geom = MultiLineString(geom)
        elif geom is not None and geom.geom_type != "MultiLineString":
            # Fallback: do not assign unsupported geometry types.
            geom = None

    road = None
    if edit_request.riyadh_road_id is not None:
        road = _resolve_riyadh_road(edit_request.riyadh_road_id)

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
    _persist_riyadh_road_label_columns(road, fields.get("name") or "")


def _publish_manual_new_road_from_edit_request(edit_request):
    """
    Insert an approved hand-drawn road into riyadh_roads.

    Returns (remote road id, fclass stored for MVT symbology).
    """
    if not edit_request:
        return None, None

    geometry_json = edit_request.geometry
    if not geometry_json:
        raise ValueError("Missing geometry for approved manual road.")

    normalized_geometry = _ensure_wgs84_geometry(geometry_json, source_srid=3857)
    try:
        _validate_line_geojson_for_edit(normalized_geometry)
    except ValueError as exc:
        logger.warning("Invalid manual road geometry on apply: %s", exc)
        raise

    fields_data = (
        edit_request.fields_data if isinstance(edit_request.fields_data, dict) else None
    )
    fields = prepare_road_fields_for_publish(
        fields_data=fields_data,
        current_feature_label=edit_request.current_feature_label,
    )
    remote_id = publish_geometry_to_riyadh_roads(
        normalized_geometry,
        fields_data=fields,
        current_feature_label=edit_request.current_feature_label,
        road_closure=int(edit_request.road_closure or 0),
    )
    return remote_id, normalize_published_fclass(fields.get("fclass"))


def _set_published_road_id_after_approval(edit_request, *, remote_road_id=None):
    """Persist map target id on approved rows; deletes leave null."""
    if is_delete_road_request(edit_request):
        edit_request.published_road_id = None
    elif remote_road_id is not None:
        try:
            edit_request.published_road_id = int(float(remote_road_id))
        except (TypeError, ValueError):
            edit_request.published_road_id = None
    elif edit_request.riyadh_road_id is not None:
        edit_request.published_road_id = int(edit_request.riyadh_road_id)
    else:
        edit_request.published_road_id = None
    edit_request.save(update_fields=["published_road_id", "updated_at"])


def _apply_riyadh_road_closure_remote(riyadh_road_id_int, road_closure: int):
    """Persist road_closure on the remote riyadh_roads row (no local workflow)."""
    road = _resolve_riyadh_road(int(riyadh_road_id_int))
    if not road:
        raise ValueError("Road not found for closure update.")
    rc = 1 if int(road_closure) == 1 else 0
    road.road_closure = rc
    road.save(using="riyadh_roads", update_fields=["road_closure"])


def _norm_str_edit(v):
    if v is None:
        return ""
    return str(v).strip()


def _riyadh_effective_fields_when_closure_changed(fields_data, road):
    """
    Merge client fields with DB for review checks after an immediate closure write.

    Omitted or empty payload keys are treated as unchanged so a closure-only save is
    not forced into manager review when the client did not send every column.
    """
    fd = fields_data or {}

    def pick(field):
        if field not in fd:
            return getattr(road, field, None)
        v = fd[field]
        if v is None or v == "" or v == []:
            return getattr(road, field, None)
        return v

    return {
        "name": pick("name"),
        "ref": pick("ref"),
        # For closure-only flow, treat style/classification as unchanged to avoid
        # false manager-review triggers from label↔fclass serialization drift.
        "fclass": getattr(road, "fclass", None),
        "oneway": pick("oneway"),
        "maxspeed": pick("maxspeed"),
        "osm_id": pick("osm_id"),
        "code": pick("code"),
        "bridge": pick("bridge"),
        "tunnel": pick("tunnel"),
        "layer": pick("layer"),
        # DB-derived geometry metric; not a user edit in closure flow.
        "shape_length": getattr(road, "shape_length", None),
        "road_closure": pick("road_closure"),
    }


def _riyadh_fields_match_remote(fields_data, road) -> bool:
    """Compare editable riyadh columns to payload (after any immediate closure write)."""
    fd = fields_data or {}
    if _norm_str_edit(fd.get("name")) != _norm_str_edit(road.name):
        return False
    if _norm_str_edit(fd.get("ref")) != _norm_str_edit(road.ref):
        return False
    if _norm_str_edit(fd.get("fclass")) != _norm_str_edit(road.fclass):
        return False
    if _norm_str_edit(fd.get("oneway")) != _norm_str_edit(road.oneway):
        return False
    if not riyadh_decimal_eq(fd.get("maxspeed"), road.maxspeed):
        return False
    if _norm_str_edit(fd.get("osm_id")) != _norm_str_edit(road.osm_id):
        return False
    if not riyadh_decimal_eq(fd.get("code"), road.code):
        return False
    if _norm_str_edit(fd.get("bridge")) != _norm_str_edit(road.bridge):
        return False
    if _norm_str_edit(fd.get("tunnel")) != _norm_str_edit(road.tunnel):
        return False
    if not riyadh_decimal_eq(fd.get("layer"), road.layer):
        return False
    try:
        rc_payload = int(fd.get("road_closure") or 0)
    except (TypeError, ValueError):
        rc_payload = 0
    rc_payload = 1 if rc_payload == 1 else 0
    rc_db = int(getattr(road, "road_closure", 0) or 0)
    rc_db = 1 if rc_db == 1 else 0
    if rc_payload != rc_db:
        return False
    return True


def _riyadh_extra_fields_require_review(fields_data) -> bool:
    fd = fields_data or {}
    for k, v in fd.items():
        if (
            k in RIYADH_REMOTE_FIELD_KEYS
            or k in RIYADH_FIELDS_UI_ONLY
            or k in RIYADH_FIELDS_NON_REVIEWABLE
        ):
            continue
        if v in (None, "", [], {}):
            continue
        return True
    return False


def _riyadh_tags_match_client(tags_data, fields_data) -> bool:
    """Tags must match fields_data for keys that are not exclusive to other sidebar controls."""
    skip_keys = RIYADH_SIDEBAR_EXCLUSIVE_FIELD_KEYS | RIYADH_FIELDS_UI_ONLY
    canon_pairs = []
    fd = fields_data or {}
    for key, value in fd.items():
        if key in skip_keys:
            continue
        if value in (None, "", [], {}):
            continue
        canon_pairs.append((key, str(value)))
    canon_pairs.sort()
    client_pairs = sorted(
        (
            t.get("key"),
            str(t.get("value", "")),
        )
        for t in (tags_data or [])
        if t.get("key") not in skip_keys
    )
    return tuple(canon_pairs) == tuple(client_pairs)


def _is_closure_only_no_review_candidate(
    relations_data,
    geometry_changed: bool,
    closure_changed: bool,
    has_extra_fields: bool,
    fields_match_remote: bool,
) -> bool:
    """
    Return True when the request is effectively a closure-only change.

    In this mode, road_closure is written live for all roles and should not be
    blocked by passive payload-vs-DB drift in mirrored sidebar attributes.
    """
    if not (
        closure_changed
        and not geometry_changed
        and not relations_data
        and not has_extra_fields
        and fields_match_remote
    ):
        return False

    return True


def _riyadh_needs_manager_review(
    fields_data,
    tags_data,
    relations_data,
    road,
    geometry_changed: bool,
    closure_changed: bool,
) -> bool:
    has_extra_fields = _riyadh_extra_fields_require_review(fields_data)
    effective_fields = (
        _riyadh_effective_fields_when_closure_changed(fields_data, road)
        if closure_changed
        else fields_data
    )
    fields_match_remote = _riyadh_fields_match_remote(effective_fields, road)

    # Product rule: road closure changes are live immediately for all roles.
    if _is_closure_only_no_review_candidate(
        relations_data,
        geometry_changed,
        closure_changed,
        has_extra_fields,
        fields_match_remote,
    ):
        return False

    if geometry_changed:
        return True
    if relations_data:
        return True
    if has_extra_fields:
        return True
    if not fields_match_remote:
        return True
    if not _riyadh_tags_match_client(tags_data, fields_data):
        return True
    return False


def _apply_delete_to_base_network(edit_request):
    """Apply a delete request to the remote base network (hard delete)."""
    if not edit_request:
        return

    if not is_delete_road_request(edit_request):
        return

    if not edit_request.is_riyadh_road or edit_request.riyadh_road_id is None:
        raise ValueError("Delete requests must target a Riyadh road identifier.")

    identifier = int(edit_request.riyadh_road_id)

    road = _resolve_riyadh_road(identifier)
    if not road:
        raise ValueError("Target Riyadh road not found for delete.")

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

    applies_immediately = user_edits_apply_immediately(request.user)

    # Resolve target and capture a geometry snapshot for review.
    is_riyadh_road = False
    riyadh_road_id_int = None
    geometry = None
    current_feature_label = None
    fields_data = {}
    tags_data = []
    relations_data = []

    try:
        is_riyadh_road = True
        riyadh_road_id_int = target_gid_int

        road = _resolve_riyadh_road(target_gid_int)
        if not road:
            return JsonResponse(
                {
                    "success": False,
                    "message": "Target Riyadh road not found for delete request.",
                },
                status=404,
            )

        geometry = _get_riyadh_road_geometry_wgs84(getattr(road, "gid", target_gid_int))
        feature_label = feature_label_from_riyadh_fclass(getattr(road, "fclass", None))
        current_feature_label = feature_label

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

    delete_request = create_pending_road_edit_request(
        road=road,
        requester=request.user,
        status="pending",
        edit_type=EDIT_TYPE_DELETE,
        geometry=_ensure_wgs84_geometry(geometry, source_srid=3857),
        current_feature_label=current_feature_label or "Unnamed Road",
        fields_data=fields_data,
        tags_data=tags_data,
        relations_data=relations_data,
        is_riyadh_road=is_riyadh_road,
        riyadh_road_id=riyadh_road_id_int,
    )

    auto_approved = False
    deleted_road_id = None
    if applies_immediately:
        try:
            _apply_delete_to_base_network(delete_request)
            deleted_road_id = riyadh_road_id_int
            _set_published_road_id_after_approval(delete_request)
            delete_request.approve(request.user)
            auto_approved = True
        except Exception as e:
            return JsonResponse(
                {
                    "success": False,
                    "message": f"Failed to apply delete to remote network: {str(e)}",
                },
                status=500,
            )

    payload = {
        "success": True,
        "message": (
            "Delete request submitted."
            if not auto_approved
            else "Delete request approved and applied."
        ),
        "request_id": delete_request.id,
        "auto_approved": auto_approved,
        "pending_submitted": not auto_approved,
    }
    if auto_approved:
        payload.update(network_mutation_payload(deleted_road_id=deleted_road_id))
    return JsonResponse(payload)


@login_required
def list_my_edit_requests(request):
    """Return the current user's road edit submission history."""
    if not has_my_edits_access(request.user):
        return JsonResponse(
            {
                "success": False,
                "message": "You do not have permission to view My Edits.",
            },
            status=403,
        )

    try:
        qs = (
            LineEditRequest.objects.filter(requester=request.user)
            .select_related("reviewed_by")
            .order_by("-created_at")
        )

        qs = apply_my_edits_filters(qs, request)
        requests = list(qs[:EDIT_LIST_LIMIT])
        items = serialize_edit_request_list(requests, serialize_my_edit_request_item)

        return JsonResponse(
            {
                "success": True,
                "requests": items,
                "count": len(items),
                "limit": EDIT_LIST_LIMIT,
            }
        )
    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error fetching edit history: {str(e)}",
            },
            status=500,
        )


@login_required
def list_manager_review_history(request):
    """Return approved/rejected editor submissions for manager review history."""
    if not user_is_manager(request.user):
        return JsonResponse(
            {
                "success": False,
                "message": "Only managers can access review history.",
            },
            status=403,
        )

    try:
        qs = (
            filter_editor_submissions(
                LineEditRequest.objects.filter(
                    status__in=["approved", "rejected"],
                )
            )
            .select_related("requester", "requester__profile", "reviewed_by")
            .order_by("-reviewed_at", "-created_at")
        )

        scope = parse_review_history_scope(request)
        qs = apply_review_history_filters(qs, request, request.user)
        requests = list(qs[:EDIT_LIST_LIMIT])
        items = serialize_edit_request_list(
            requests, serialize_manager_review_history_item
        )

        return JsonResponse(
            {
                "success": True,
                "requests": items,
                "count": len(items),
                "limit": EDIT_LIST_LIMIT,
                "scope": scope,
            }
        )
    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "message": f"Error fetching review history: {str(e)}",
            },
            status=500,
        )


@login_required
def list_pending_requests(request):
    """Return pending editor submissions for the manager approval queue."""
    if not user_is_manager(request.user):
        return JsonResponse({
            'success': False,
            'message': 'Only managers can access the approval queue.',
        }, status=403)
    
    try:
        requests = (
            filter_editor_submissions(
                LineEditRequest.objects.filter(status="pending")
            )
            .select_related("requester", "requester__profile")
            .order_by("-created_at")
        )

        riyadh_ids = [
            req.riyadh_road_id
            for req in requests
            if req.is_riyadh_road and req.riyadh_road_id is not None
        ]
        roads_by_id = {}
        if riyadh_ids:
            for road in RiyadhRoad.objects.using("riyadh_roads").filter(gid__in=riyadh_ids):
                roads_by_id[int(road.gid)] = road

        requests_data = []
        for req in requests:
            profile = getattr(req.requester, "profile", None)
            profile_image_url = (
                profile.profile_image.url if profile and profile.profile_image else None
            )

            geometry = _ensure_wgs84_geometry(req.geometry, source_srid=3857)

            orig_geom = (
                _ensure_wgs84_geometry(req.original_geometry, source_srid=3857)
                if req.original_geometry
                else None
            )

            road = (
                roads_by_id.get(int(req.riyadh_road_id))
                if req.riyadh_road_id is not None
                else None
            )

            requests_data.append(
                serialize_approval_request_list_item(
                    req,
                    road=road,
                    profile_image_url=profile_image_url,
                    geometry_wgs84=geometry,
                    original_geometry_wgs84=orig_geom,
                )
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
    """Return full details of a single item in the manager approval queue."""
    if not user_is_manager(request.user):
        return JsonResponse({
            'success': False,
            'message': 'Only managers can access the approval queue.',
        }, status=403)
    
    try:
        try:
            edit_request = get_object_or_404(LineEditRequest, id=request_id)
        except Http404:
            return JsonResponse(
                {
                    "success": False,
                    "message": "Approval request not found for the given id.",
                },
                status=404,
            )

        profile = getattr(edit_request.requester, "profile", None)
        profile_image_url = (
            profile.profile_image.url if profile and profile.profile_image else None
        )

        geometry = _ensure_wgs84_geometry(edit_request.geometry, source_srid=3857)
        original_geometry = (
            _ensure_wgs84_geometry(edit_request.original_geometry, source_srid=3857)
            if edit_request.original_geometry
            else None
        )

        fields_data = (
            edit_request.fields_data if isinstance(edit_request.fields_data, dict) else {}
        )
        road = None
        if edit_request.is_riyadh_road and edit_request.riyadh_road_id is not None:
            road = _resolve_riyadh_road(edit_request.riyadh_road_id)

        return JsonResponse(
            {
                "success": True,
                "request": serialize_approval_request_detail(
                    edit_request,
                    road=road,
                    profile_image_url=profile_image_url,
                    geometry_wgs84=geometry,
                    original_geometry_wgs84=original_geometry,
                ),
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
    """Approve a pending road edit in the manager approval queue."""
    if not user_is_manager(request.user):
        return JsonResponse({
            'success': False,
            'message': 'Only managers can approve items in the approval queue.',
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id, status="pending")
        remote_road_id = None

        if is_layer_upload_request(edit_request):
            remote_road_id, published_fclass = approve_layer_upload_edit_request(
                edit_request
            )
            _set_published_road_id_after_approval(
                edit_request, remote_road_id=remote_road_id
            )
            edit_request.approve(request.user)
            return JsonResponse(
                {
                    "success": True,
                    "message": "Layer upload approved and published to the road network",
                    **network_mutation_payload(
                        remote_road_id=remote_road_id,
                        fclass=published_fclass,
                    ),
                }
            )

        deleted_road_id = None
        published_fclass = None
        if is_delete_road_request(edit_request):
            deleted_road_id = (
                int(edit_request.riyadh_road_id)
                if edit_request.riyadh_road_id is not None
                else None
            )
            _apply_delete_to_base_network(edit_request)
        else:
            if edit_request.is_riyadh_road:
                _apply_riyadh_edit_to_base_network(edit_request)
                remote_road_id = edit_request.riyadh_road_id
                published_fclass = published_fclass_from_edit_request(edit_request)
            else:
                remote_road_id, published_fclass = (
                    _publish_manual_new_road_from_edit_request(edit_request)
                )

        _set_published_road_id_after_approval(
            edit_request, remote_road_id=remote_road_id
        )
        edit_request.approve(request.user)

        message = "Road edit approved successfully"
        if deleted_road_id is not None:
            message = "Delete request approved; road removed from the network"

        return JsonResponse(
            {
                "success": True,
                "message": message,
                **network_mutation_payload(
                    remote_road_id=remote_road_id,
                    fclass=published_fclass,
                    deleted_road_id=deleted_road_id,
                ),
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
    """Reject a pending road edit in the manager approval queue."""
    if not user_is_manager(request.user):
        return JsonResponse({
            'success': False,
            'message': 'Only managers can reject items in the approval queue.',
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id, status='pending')

        if is_layer_upload_request(edit_request):
            reject_layer_upload_edit_request(edit_request)
            edit_request.reject(request.user)
            return JsonResponse({
                'success': True,
                'message': 'Layer upload rejected',
            })

        edit_request.reject(request.user)

        return JsonResponse({
            'success': True,
            'message': 'Road edit rejected',
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error rejecting request: {str(e)}'
        }, status=500)


@login_required
@require_http_methods(["GET"])
def get_riyadh_road_details(request, road_gid):  # URL segment; value is tile network `id`
    """
    Return geometry and metadata for a single Riyadh road.

    The identifier comes from the vector tile feature's `id` property. Depending
    on how the tiles were generated, that may correspond to either the
    PostGIS primary key `gid` or the secondary `id` column. To avoid tight
    coupling to tileserver configuration, we resolve the road by trying both.
    """
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

    identifier = int(road_gid)
    road = _resolve_riyadh_road(identifier)
    if not road:
        return JsonResponse(
            {
                "success": False,
                "message": "Riyadh road not found for the given id.",
            },
            status=404,
        )

    try:
        # `road.geom.json` is GeoJSON without SRID metadata and can be ambiguous.
        # For reliable WGS84 output (used by the geometry editor / vertex handles),
        # transform the geometry object itself from its known SRID.
        geometry = None
        try:
            geom_obj = getattr(road, "geom", None)
            if geom_obj:
                geom_obj.transform(4326)
                geometry = json.loads(geom_obj.json)
        except Exception:
            # Fallback: try to normalize whatever we can.
            try:
                raw_geometry = json.loads(road.geom.json) if road.geom else None
            except Exception:
                raw_geometry = None
            geometry = _ensure_wgs84_geometry(raw_geometry, source_srid=3857)

        _rc_raw = _sanitize_number(getattr(road, "road_closure", 0)) or 0
        try:
            road_closure_int = 1 if int(_rc_raw) == 1 else 0
        except (TypeError, ValueError):
            road_closure_int = 0

        name_en_db, name_ar_db = _get_riyadh_road_bilingual_names_by_gid(getattr(road, "gid", None))
        display_label = name_en_db or name_ar_db or (road.name or "").strip()

        fields_data = {
            "gid": getattr(road, "gid", None),
            # The stable identifier used by vector tiles / MapLibre promoteId.
            "id": _sanitize_number(getattr(road, "id", None)),
            "objectid": str(road.objectid) if getattr(road, "objectid", None) is not None else "",
            "name": display_label,
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
            "road_closure": road_closure_int,
        }

        tags_data = []
        for key, value in fields_data.items():
            if key in RIYADH_FIELDS_OMIT_FROM_TAGS:
                continue
            if value in (None, "", [], {}):
                continue
            tags_data.append({"key": key, "value": str(value)})

        # Use whichever identifier matches the incoming value so that round‑trips
        # between tiles, API, and editor remain consistent.
        road_identifier = identifier
        feature_label = feature_label_from_riyadh_fclass(getattr(road, "fclass", None))
        payload = {
            "id": road_identifier,
            "riyadh_road_id": road_identifier,
            "is_riyadh_road": True,
            "geometry": geometry,
            "road_closure": road_closure_int,
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
