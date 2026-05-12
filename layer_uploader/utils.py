import json
import re
import uuid

import fiona
from django.contrib.gis.geos import GEOSGeometry
from django.db import connections, transaction
from psycopg2 import Binary, sql
from psycopg2.extras import execute_values


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


def simplify_crs(crs):
    """
    Extract readable CRS name and EPSG from WKT or dict
    """
    if not crs:
        return "Unknown CRS", None

    crs_str = str(crs)

    # Extract EPSG (last occurrence is usually correct)
    epsg_match = re.findall(r'EPSG\",\"(\d+)\"', crs_str)
    epsg = epsg_match[-1] if epsg_match else None

    # Extract projection name
    name_match = re.search(r'PROJCS\[\"([^\"]+)\"', crs_str)

    if name_match:
        name = name_match.group(1)
    else:
        name = "Unknown CRS"

    return name, epsg


def coerce_epsg(value):
    if value in (None, "", "Not defined"):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_source_epsg(crs):
    if not crs:
        return None

    try:
        to_epsg = getattr(crs, "to_epsg", None)
        if callable(to_epsg):
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

    _, fallback_epsg = simplify_crs(crs)
    return coerce_epsg(fallback_epsg)


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
    rows_to_insert = []

    with fiona.open(shapefile_path) as source:
        source_srid = _extract_source_epsg(source.crs) or target_srid

        for feature in source:
            geometry_data = feature.get("geometry")
            if not geometry_data:
                continue

            # Fiona 2.x returns fiona.model.Geometry objects, not plain dicts.
            # Convert via __geo_interface__ to get a JSON-serializable dict.
            if hasattr(geometry_data, "__geo_interface__"):
                geometry_data = geometry_data.__geo_interface__

            geom = GEOSGeometry(json.dumps(geometry_data))
            geom.srid = int(source_srid)
            if geom.srid != target_srid:
                geom.transform(target_srid)

            raw_props = feature.get("properties") or {}
            # Fiona 2.x Properties objects also need conversion to plain dict.
            if hasattr(raw_props, "__geo_interface__"):
                raw_props = dict(raw_props.__geo_interface__)
            properties = dict(raw_props)
            rows_to_insert.append((Binary(bytes(geom.wkb)), json.dumps(properties, cls=_SafeJsonEncoder)))

    if not rows_to_insert:
        return []

    new_features = []

    with transaction.atomic(using=connection_alias):
        with connections[connection_alias].cursor() as cursor:
            temp_table_identifier = sql.Identifier(temp_table_name)
            target_table_identifier = sql.Identifier(target_schema, target_table)

            # Create temp table with geometry + properties columns.
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

            # Bulk-insert all shapefile geometries + properties.
            # as_string() needs a raw psycopg2 connection, not Django's cursor wrapper.
            raw_conn = connections[connection_alias].connection
            quoted_temp_table = temp_table_identifier.as_string(raw_conn)
            execute_values(
                cursor,
                f"INSERT INTO {quoted_temp_table} (geom, properties) VALUES %s",
                rows_to_insert,
                # GEOSGeometry.wkb returns EWKB (Extended WKB with embedded SRID).
                # ST_GeomFromEWKB handles EWKB natively; ST_GeomFromWKB would reject it.
                template="(ST_GeomFromEWKB(%s), %s::jsonb)",
                page_size=1000,
            )

            # Find features that don't exist in the target table,
            # transforming geometry to output_srid for storage in Feature model.
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
                          AND ST_Equals(s.geom, r.geom)
                    )
                    """
                ).format(
                    output_srid=sql.Literal(output_srid),
                    temp=temp_table_identifier,
                    target=target_table_identifier,
                )
            )

            for row in cursor.fetchall():
                wkb_data = row[0]
                props = row[1] if row[1] else {}
                if wkb_data:
                    geom = _geometry_from_db_wkb(wkb_data, srid=output_srid)
                    new_features.append({
                        "geom": geom,
                        "properties": props,
                    })

    return new_features
