// Centralized GeoJSON normalization for the map editor.
// Single source of truth for:
// - extracting a usable LineString from GeoJSON (Geometry / Feature / FeatureCollection)
// - producing WGS84 [lng, lat] coordinates suitable for MapLibre marker vertices
//
// This module intentionally does NOT attempt to "guess" SRIDs (e.g. auto-convert
// 3857 meters) in production. The backend is responsible for returning WGS84 for
// editor payloads (see mapping/views.py). If a non-WGS84 geometry slips through,
// we fail loudly (return null) so the UI can show a clear message.
(function () {
    'use strict';

    function normalizeToLineStringGeometry(input) {
        if (!input) return null;

        let geom = input;
        if (geom.type === 'Feature' && geom.geometry) {
            geom = geom.geometry;
        } else if (
            geom.type === 'FeatureCollection' &&
            Array.isArray(geom.features) &&
            geom.features.length
        ) {
            const first = geom.features[0];
            if (first && first.geometry) {
                geom = first.geometry;
            }
        }

        if (!geom || !geom.type) return null;

        if (geom.type === 'LineString') {
            return Array.isArray(geom.coordinates) && geom.coordinates.length >= 2
                ? geom
                : null;
        }

        if (geom.type === 'MultiLineString') {
            const coords = geom.coordinates;
            if (!Array.isArray(coords) || !coords.length) return null;
            for (let i = 0; i < coords.length; i++) {
                const line = coords[i];
                if (Array.isArray(line) && line.length >= 2) {
                    return { type: 'LineString', coordinates: line };
                }
            }
            return null;
        }

        if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
            for (let i = 0; i < geom.geometries.length; i++) {
                const normalized = normalizeToLineStringGeometry(geom.geometries[i]);
                if (normalized) return normalized;
            }
        }

        return null;
    }

    function looksLikeWgs84LngLat(lng, lat) {
        return (
            Number.isFinite(lng) &&
            Number.isFinite(lat) &&
            lng >= -180 &&
            lng <= 180 &&
            lat >= -90 &&
            lat <= 90
        );
    }

    function lineStringCoordsToEditableWgs84(coords) {
        if (!Array.isArray(coords) || coords.length < 2) return null;

        const cleaned = [];
        for (let i = 0; i < coords.length; i++) {
            const pt = coords[i];
            if (!pt || pt.length < 2) return null;

            const lng = Number(pt[0]);
            const lat = Number(pt[1]);
            if (!looksLikeWgs84LngLat(lng, lat)) {
                return null;
            }
            cleaned.push([lng, lat]);
        }

        return cleaned.length >= 2 ? cleaned : null;
    }

    function extractEditableLineCoordsWgs84(input) {
        const geom = normalizeToLineStringGeometry(input);
        if (!geom) return null;
        return lineStringCoordsToEditableWgs84(geom.coordinates);
    }

    window.GeometryNormalize = {
        normalizeToLineStringGeometry,
        extractEditableLineCoordsWgs84,
        lineStringCoordsToEditableWgs84,
    };
})();

