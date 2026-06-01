import json
import re
import uuid

import fiona
from django.contrib.gis.geos import GEOSGeometry
from django.db import connections, transaction
from psycopg2 import Binary, sql
from psycopg2.extras import execute_values

from .constants import ROAD_NETWORK_OVERLAP_TOLERANCE_M, SHAPEFILE_INSERT_BATCH_SIZE
from .shapefile_properties import coerce_feature_properties


class _SafeJsonEncoder(json.JSONEncoder):
    """Fallback encoder that converts any non-serializable value to its string
    representation.  Shapefile DBF fields can contain dates, Decimals, Fiona
    Geometry objects and other types that the stdlib encoder rejects."""

    def default(self, obj):
        try:
            return super().default(obj)
        except TypeError:
            return str(obj)


def _normalize_wkb_buffer(wkb_data):
    """Django 6 accepts binary WKB via memoryview, while psycopg2 may return bytes."""
    if isinstance(wkb_data, memoryview):
        return wkb_data
    if isinstance(wkb_data, (bytes, bytearray)):
        return memoryview(wkb_data)
    return wkb_data


def _geometry_from_db_wkb(wkb_data, *, srid):
    geom = GEOSGeometry(_normalize_wkb_buffer(wkb_data))
    geom.srid = srid
    return geom


# Friendly labels for common EPSG codes (Fiona often returns only ``EPSG:####``).
_KNOWN_EPSG_LABELS: dict[int, str] = {
    3857: "WGS 84 / Pseudo-Mercator (Web Mercator)",
    4326: "WGS 84",
    32637: "WGS 84 / UTM zone 37N",
    32638: "WGS 84 / UTM zone 38N",
    32639: "WGS 84 / UTM zone 39N",
}


def _crs_epsg_code(crs) -> int | None:
    """Resolve an integer EPSG code from Fiona CRS, WKT, or legacy dict forms."""
    if not crs:
        return None

    to_epsg = getattr(crs, "to_epsg", None)
    if callable(to_epsg):
        try:
            epsg = to_epsg()
            if epsg:
                return int(epsg)
        except Exception:
            pass

    if isinstance(crs, dict):
        raw_epsg = crs.get("init") or crs.get("INIT") or crs.get("epsg") or crs.get("EPSG")
        if isinstance(raw_epsg, str) and ":" in raw_epsg:
            raw_epsg = raw_epsg.rsplit(":", 1)[-1]
        epsg = coerce_epsg(raw_epsg)
        if epsg:
            return epsg

    crs_str = str(crs).strip()

    epsg_prefix = re.match(r"^EPSG:(\d+)$", crs_str, re.IGNORECASE)
    if epsg_prefix:
        return int(epsg_prefix.group(1))

    for pattern in (
        r'AUTHORITY\["EPSG","(\d+)"\]',
        r'EPSG","(\d+)"',
    ):
        matches = re.findall(pattern, crs_str)
        if matches:
            return int(matches[-1])

    return None


def _crs_display_name(crs, epsg: int | None) -> str:
    if epsg and epsg in _KNOWN_EPSG_LABELS:
        return _KNOWN_EPSG_LABELS[epsg]

    crs_str = str(crs)
    for pattern in (r'PROJCS\["([^"]+)"', r'GEOGCS\["([^"]+)"'):
        name_match = re.search(pattern, crs_str)
        if name_match:
            return name_match.group(1).replace("_", " ")

    if epsg:
        return f"EPSG:{epsg}"
    return "Unknown CRS"


def simplify_crs(crs):
    """Return (human-readable CRS name, EPSG code string or None) for UI display."""
    if not crs:
        return "Unknown CRS", None

    epsg = _crs_epsg_code(crs)
    name = _crs_display_name(crs, epsg)
    return name, str(epsg) if epsg else None


def coerce_epsg(value):
    if value in (None, "", "Not defined"):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_source_epsg(crs):
    return _crs_epsg_code(crs)


def find_new_features_against_riyadh_roads(
    shapefile_path,
    *,
    connection_alias="riyadh_roads",
    target_schema="public",
    target_table="riyadh_roads",
    target_srid=3857,
    output_srid=4326,
):
    """
    Upload shapefile geometries into a temp table on the riyadh_roads DB,
    compare against existing roads, and return new features that don't exist.

    Returns a list of dicts:
        [{'geom': GEOSGeometry(srid=output_srid), 'properties': dict}, ...]
    """
    target_srid = int(target_srid)
    output_srid = int(output_srid)
    temp_table_name = f"temp_layer_upload_{uuid.uuid4().hex[:12]}"

    def _flush_batch(cursor, quoted_temp_table, batch):
        if not batch:
            return
        execute_values(
            cursor,
            f"INSERT INTO {quoted_temp_table} (geom, properties) VALUES %s",
            batch,
            template="(ST_GeomFromEWKB(%s), %s::jsonb)",
            page_size=1000,
        )
        batch.clear()

    new_features = []

    with transaction.atomic(using=connection_alias):
        with connections[connection_alias].cursor() as cursor:
            temp_table_identifier = sql.Identifier(temp_table_name)
            target_table_identifier = sql.Identifier(target_schema, target_table)

            cursor.execute(
                sql.SQL(
                    "CREATE TEMP TABLE {} ("
                    "  geom geometry(Geometry, {}),"
                    "  properties jsonb"
                    ") ON COMMIT DROP"
                ).format(
                    temp_table_identifier,
                    sql.Literal(target_srid),
                )
            )

            raw_conn = connections[connection_alias].connection
            quoted_temp_table = temp_table_identifier.as_string(raw_conn)
            insert_batch = []
            row_count = 0

            with fiona.open(shapefile_path) as source:
                source_srid = _extract_source_epsg(source.crs) or target_srid

                for feature in source:
                    geometry_data = feature.get("geometry")
                    if not geometry_data:
                        continue

                    if hasattr(geometry_data, "__geo_interface__"):
                        geometry_data = geometry_data.__geo_interface__

                    geom = GEOSGeometry(json.dumps(geometry_data))
                    geom.srid = int(source_srid)
                    if geom.srid != target_srid:
                        geom.transform(target_srid)

                    raw_props = feature.get("properties") or {}
                    properties = dict(raw_props)
                    insert_batch.append(
                        (Binary(bytes(geom.wkb)), json.dumps(properties, cls=_SafeJsonEncoder))
                    )
                    row_count += 1
                    if len(insert_batch) >= SHAPEFILE_INSERT_BATCH_SIZE:
                        _flush_batch(cursor, quoted_temp_table, insert_batch)

            if row_count == 0:
                return []

            _flush_batch(cursor, quoted_temp_table, insert_batch)

            # Exclude upload features within ROAD_NETWORK_OVERLAP_TOLERANCE_M of the
            # live network. Only non-overlapping rows are staged for review.
            overlap_tolerance = sql.Literal(float(ROAD_NETWORK_OVERLAP_TOLERANCE_M))
            cursor.execute(
                sql.SQL(
                    """
                    SELECT ST_AsBinary(ST_Transform(s.geom, {output_srid})),
                           s.properties
                    FROM {temp} s
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM {target} r
                        WHERE s.geom && r.geom
                          AND ST_DWithin(s.geom, r.geom, {overlap_tolerance})
                    )
                    """
                ).format(
                    output_srid=sql.Literal(output_srid),
                    overlap_tolerance=overlap_tolerance,
                    temp=temp_table_identifier,
                    target=target_table_identifier,
                )
            )

            for row in cursor.fetchall():
                wkb_data = row[0]
                props = coerce_feature_properties(row[1])
                if wkb_data:
                    geom = _geometry_from_db_wkb(wkb_data, srid=output_srid)
                    new_features.append({
                        "geom": geom,
                        "properties": props,
                    })

    return new_features
