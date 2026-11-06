/**
 * Pending-review road locks: labeled map highlight + edit gates until approve/reject.
 * Uses window.geotrakMaplibreMap (never window.map - that is the #map HTMLElement).
 */
(function (global) {
    'use strict';

    var SOURCE_ID = 'pending-road-locks-src';
    var LAYER_CASING_ID = 'pending-road-locks-casing';
    var LAYER_LINE_ID = 'pending-road-locks-line';
    var LAYER_LABEL_ID = 'pending-road-locks-label';
    var API_URL = '/mapping/api/pending-road-locks/';
    var LINE_TYPE_FILTER = [
        'in',
        ['geometry-type'],
        ['literal', ['LineString', 'MultiLineString']],
    ];
    /** Same-path gate; keep in sync with mapping/pending_road_locks.py */
    var SAME_PATH_CORRIDOR_M = 3;
    var SAME_PATH_OVERLAP_FRACTION = 0.55;
    var LABEL_FONT = ['Open Sans Semibold', 'Arial Unicode MS Bold'];

    var roadIds = Object.create(null);
    var roads = [];
    var newRoads = [];
    var refreshTimer = null;
    var loadPromise = null;
    var mapHooked = false;
    /** When manager is reviewing one request, mute the global pending overlay so compare lines stay clear. */
    var focusedReviewActive = false;

    function uiT(key, fallback) {
        if (typeof global.uiT === 'function') {
            return global.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function notify(message, kind) {
        if (global.notify && typeof global.notify.tryShow === 'function') {
            global.notify.tryShow(message, kind || 'info');
        }
    }

    function getMap() {
        var map = global.geotrakMaplibreMap;
        return map && typeof map.getSource === 'function' ? map : null;
    }

    function normalizeId(value) {
        if (value == null || value === '') {
            return null;
        }
        var n = parseInt(String(value), 10);
        return Number.isNaN(n) ? null : n;
    }

    function coerceLineGeometry(value) {
        var geom = value;
        if (geom == null) {
            return null;
        }
        if (typeof geom === 'string') {
            try {
                geom = JSON.parse(geom);
            } catch (eParse) {
                return null;
            }
        }
        if (!geom || typeof geom !== 'object') {
            return null;
        }
        if (geom.type === 'Feature') {
            geom = geom.geometry;
        } else if (geom.type === 'FeatureCollection') {
            var first = (geom.features && geom.features[0]) || null;
            geom = first && first.type === 'Feature' ? first.geometry : first;
        }
        if (
            !geom ||
            (geom.type !== 'LineString' && geom.type !== 'MultiLineString') ||
            !geom.coordinates ||
            !geom.coordinates.length
        ) {
            return null;
        }
        return { type: geom.type, coordinates: geom.coordinates };
    }

    function rebuildIdIndex(list) {
        roadIds = Object.create(null);
        (list || []).forEach(function (row) {
            var id = normalizeId(row && row.road_id);
            if (id != null) {
                roadIds[id] = row;
            }
        });
    }

    function isRoadLocked(roadId) {
        var id = normalizeId(roadId);
        return id != null && !!roadIds[id];
    }

    function resolveContextRoadId(ctx) {
        if (!ctx) {
            return null;
        }
        if (ctx.riyadh_road_id != null) {
            return normalizeId(ctx.riyadh_road_id);
        }
        return normalizeId(ctx.id);
    }

    function isSelectedRoadLocked() {
        var ctx = global.approvedLineBeingEdited || global.selectedRiyadhRoad || null;
        if (!ctx || !ctx.is_riyadh_road) {
            return false;
        }
        return isRoadLocked(resolveContextRoadId(ctx));
    }

    function assertRoadEditable(roadId, options) {
        var opts = options || {};
        if (!isRoadLocked(roadId)) {
            return true;
        }
        if (opts.silent !== true) {
            notify(
                uiT(
                    'pending_road_locked',
                    'This road already has an edit waiting for review. Wait until it is approved or rejected.'
                ),
                'warning'
            );
        }
        return false;
    }

    function haversineMeters(a, b) {
        if (!a || !b || a.length < 2 || b.length < 2) {
            return Infinity;
        }
        var toRad = Math.PI / 180;
        var lat1 = Number(a[1]) * toRad;
        var lat2 = Number(b[1]) * toRad;
        var dLat = (Number(b[1]) - Number(a[1])) * toRad;
        var dLng = (Number(b[0]) - Number(a[0])) * toRad;
        var sinDLat = Math.sin(dLat / 2);
        var sinDLng = Math.sin(dLng / 2);
        var h =
            sinDLat * sinDLat +
            Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function collectLineRings(geometry) {
        var geom = coerceLineGeometry(geometry);
        if (!geom) {
            return [];
        }
        if (geom.type === 'LineString') {
            return [geom.coordinates || []];
        }
        return geom.coordinates || [];
    }

    function distancePointToSegmentMeters(p, a, b) {
        if (!p || !a || !b) {
            return Infinity;
        }
        var ax = Number(a[0]);
        var ay = Number(a[1]);
        var bx = Number(b[0]);
        var by = Number(b[1]);
        var px = Number(p[0]);
        var py = Number(p[1]);
        var dx = bx - ax;
        var dy = by - ay;
        if (dx === 0 && dy === 0) {
            return haversineMeters(p, a);
        }
        var cosLat = Math.cos(((ay + by) / 2) * (Math.PI / 180));
        var mx = 111320 * cosLat;
        var my = 110540;
        var bxm = (bx - ax) * mx;
        var bym = (by - ay) * my;
        var pxm = (px - ax) * mx;
        var pym = (py - ay) * my;
        var denom = bxm * bxm + bym * bym;
        var t = denom ? (pxm * bxm + pym * bym) / denom : 0;
        t = Math.max(0, Math.min(1, t));
        var ex = pxm - t * bxm;
        var ey = pym - t * bym;
        return Math.sqrt(ex * ex + ey * ey);
    }

    function distancePointToLineMeters(point, lineGeom) {
        var rings = collectLineRings(lineGeom);
        var min = Infinity;
        for (var r = 0; r < rings.length; r++) {
            var ring = rings[r] || [];
            for (var i = 0; i < ring.length - 1; i++) {
                var d = distancePointToSegmentMeters(point, ring[i], ring[i + 1]);
                if (d < min) {
                    min = d;
                }
            }
        }
        return min;
    }

    function sampleLinePoints(geometry, maxSamples) {
        var rings = collectLineRings(geometry);
        var points = [];
        var limit = typeof maxSamples === 'number' ? maxSamples : 24;
        rings.forEach(function (ring) {
            if (!ring || ring.length < 2) {
                return;
            }
            var step = Math.max(
                1,
                Math.ceil((ring.length - 1) / Math.max(1, Math.floor(limit / rings.length)))
            );
            for (var i = 0; i < ring.length; i += step) {
                points.push(ring[i]);
            }
            var last = ring[ring.length - 1];
            if (points[points.length - 1] !== last) {
                points.push(last);
            }
        });
        return points;
    }

    function samePathOverlapFraction(drawnGeom, pendingGeom) {
        var samples = sampleLinePoints(drawnGeom, 28);
        if (!samples.length) {
            return 0;
        }
        var inside = 0;
        for (var i = 0; i < samples.length; i++) {
            if (distancePointToLineMeters(samples[i], pendingGeom) <= SAME_PATH_CORRIDOR_M) {
                inside += 1;
            }
        }
        return inside / samples.length;
    }

    function hasSamePathPendingNewRoad(geometry) {
        var geom = coerceLineGeometry(geometry);
        if (!geom) {
            return false;
        }
        for (var i = 0; i < newRoads.length; i++) {
            var row = newRoads[i];
            if (
                row &&
                row.geometry &&
                samePathOverlapFraction(geom, row.geometry) >= SAME_PATH_OVERLAP_FRACTION
            ) {
                return true;
            }
        }
        return false;
    }

    function assertNewRoadDrawable(geometry, options) {
        var opts = options || {};
        if (!hasSamePathPendingNewRoad(geometry)) {
            return true;
        }
        if (opts.silent !== true) {
            notify(
                uiT(
                    'pending_new_road_locked',
                    'This path already has a new road waiting for review. Draw a different route, or wait until it is approved or rejected.'
                ),
                'warning'
            );
        }
        return false;
    }

    function labelForKind(kind) {
        if (kind === 'new') {
            return uiT('pending_map_label_new', 'Pending: new road');
        }
        return uiT('pending_map_label', 'Pending review');
    }

    function midpointOfLine(geometry) {
        var rings = collectLineRings(geometry);
        var ring = null;
        var bestLen = -1;
        rings.forEach(function (candidate) {
            if (!candidate || candidate.length < 2) {
                return;
            }
            if (candidate.length > bestLen) {
                bestLen = candidate.length;
                ring = candidate;
            }
        });
        if (!ring) {
            return null;
        }
        return ring[Math.floor((ring.length - 1) / 2)] || ring[0] || null;
    }

    function buildFeatureCollection() {
        var features = [];
        function pushRow(row, kind) {
            if (!row) {
                return;
            }
            var geometry = coerceLineGeometry(row.geometry);
            if (!geometry) {
                return;
            }
            var label = labelForKind(kind);
            features.push({
                type: 'Feature',
                properties: { kind: kind, label: label },
                geometry: geometry,
            });
            var mid = midpointOfLine(geometry);
            if (mid) {
                features.push({
                    type: 'Feature',
                    properties: { kind: kind, label: label, marker: 1 },
                    geometry: { type: 'Point', coordinates: mid },
                });
            }
        }
        roads.forEach(function (row) {
            pushRow(row, 'existing');
        });
        newRoads.forEach(function (row) {
            pushRow(row, 'new');
        });
        return { type: 'FeatureCollection', features: features };
    }

    function setPendingLayersVisibility(map, visible) {
        if (!map) {
            return;
        }
        var vis = visible ? 'visible' : 'none';
        [LAYER_CASING_ID, LAYER_LINE_ID, LAYER_LABEL_ID].forEach(function (id) {
            if (!map.getLayer(id)) {
                return;
            }
            try {
                map.setLayoutProperty(id, 'visibility', vis);
            } catch (eVis) {}
        });
    }

    function bringPendingLayersToFront(map) {
        if (!map || typeof map.moveLayer !== 'function' || focusedReviewActive) {
            return;
        }
        [LAYER_CASING_ID, LAYER_LINE_ID, LAYER_LABEL_ID].forEach(function (id) {
            if (map.getLayer(id)) {
                try {
                    map.moveLayer(id);
                } catch (eMove) {}
            }
        });
    }

    function setFocusedReviewActive(active) {
        focusedReviewActive = !!active;
        var map = getMap();
        if (!map) {
            return;
        }
        if (!ensureMapLayers(map) && !map.getLayer(LAYER_LINE_ID)) {
            return;
        }
        setPendingLayersVisibility(map, !focusedReviewActive);
        if (!focusedReviewActive) {
            bringPendingLayersToFront(map);
        }
    }

    function ensureMapLayers(map) {
        if (!map || !map.getStyle) {
            return false;
        }
        try {
            if (!map.isStyleLoaded || !map.isStyleLoaded()) {
                return false;
            }
        } catch (eStyle) {
            return false;
        }

        try {
            if (!map.getSource(SOURCE_ID)) {
                map.addSource(SOURCE_ID, {
                    type: 'geojson',
                    data: buildFeatureCollection(),
                });
            }
            if (!map.getLayer(LAYER_CASING_ID)) {
                map.addLayer({
                    id: LAYER_CASING_ID,
                    type: 'line',
                    source: SOURCE_ID,
                    filter: LINE_TYPE_FILTER,
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': '#fff7ed',
                        'line-width': 8,
                        'line-opacity': 0.95,
                    },
                });
            }
            if (!map.getLayer(LAYER_LINE_ID)) {
                map.addLayer({
                    id: LAYER_LINE_ID,
                    type: 'line',
                    source: SOURCE_ID,
                    filter: LINE_TYPE_FILTER,
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': '#b45309',
                        'line-width': 3.5,
                        'line-opacity': 0.95,
                        'line-dasharray': [2, 1.25],
                    },
                });
            }
            if (!map.getLayer(LAYER_LABEL_ID)) {
                map.addLayer({
                    id: LAYER_LABEL_ID,
                    type: 'symbol',
                    source: SOURCE_ID,
                    filter: ['==', ['get', 'marker'], 1],
                    minzoom: 12,
                    layout: {
                        'text-field': ['get', 'label'],
                        'text-font': LABEL_FONT,
                        'text-size': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            12,
                            11,
                            16,
                            13,
                        ],
                        'text-offset': [0, -0.15],
                        'text-anchor': 'bottom',
                        'text-allow-overlap': true,
                        'text-ignore-placement': true,
                    },
                    paint: {
                        'text-color': '#78350f',
                        'text-halo-color': '#fffbeb',
                        'text-halo-width': 2,
                        'text-halo-blur': 0.4,
                    },
                });
            }
            setPendingLayersVisibility(map, !focusedReviewActive);
            bringPendingLayersToFront(map);
            return true;
        } catch (eLayer) {
            return false;
        }
    }

    function syncMapLayers() {
        var map = getMap();
        if (!map || !ensureMapLayers(map)) {
            return;
        }
        try {
            var src = map.getSource(SOURCE_ID);
            if (src && typeof src.setData === 'function') {
                src.setData(buildFeatureCollection());
            }
            setPendingLayersVisibility(map, !focusedReviewActive);
            bringPendingLayersToFront(map);
        } catch (eSet) {}
    }

    function syncPendingBanner() {
        var screen = document.getElementById('editFeatureScreen');
        var toolbar = document.getElementById('editToolbar');
        var banner = document.getElementById('pendingRoadLockBanner');
        // Manager focused review already owns the UX - don't stack the editor lock banner.
        var locked =
            !global.managerApprovalReviewActive && isSelectedRoadLocked();

        if (toolbar) {
            toolbar.classList.toggle('is-pending-locked', locked);
        }
        if (!screen) {
            return;
        }
        if (!locked) {
            if (banner) {
                banner.hidden = true;
            }
            screen.classList.remove('is-pending-locked');
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'pendingRoadLockBanner';
            banner.className = 'msp-pending-lock';
            banner.setAttribute('role', 'status');
            var sheet = screen.querySelector('.msp-sheet') || screen;
            sheet.insertBefore(banner, sheet.firstChild);
        }
        banner.hidden = false;
        banner.innerHTML =
            '<span class="msp-pending-lock__badge">' +
            uiT('pending_road_badge', 'Pending review') +
            '</span>' +
            '<p class="msp-pending-lock__text">' +
            uiT(
                'pending_road_banner',
                'An edit for this road is waiting for manager approval. Further edits are paused until it is approved or rejected. Road closure can still be updated.'
            ) +
            '</p>';
        screen.classList.add('is-pending-locked');
    }

    function applyPayload(data) {
        roads = Array.isArray(data && data.roads) ? data.roads : [];
        newRoads = Array.isArray(data && data.new_roads) ? data.new_roads : [];
        rebuildIdIndex(roads);
        syncMapLayers();
        syncPendingBanner();
        if (typeof global.syncRoadPanelEditModeUI === 'function') {
            try {
                global.syncRoadPanelEditModeUI();
            } catch (eSync) {}
        }
    }

    function upsertOptimisticNewRoad(geometry, requestId, category) {
        var geom = coerceLineGeometry(geometry);
        if (!geom) {
            return;
        }
        var rid = normalizeId(requestId);
        var cat = category || 'new_road';
        var replaced = false;
        if (rid != null) {
            newRoads = newRoads.map(function (row) {
                if (normalizeId(row && row.request_id) === rid) {
                    replaced = true;
                    return { request_id: rid, category: cat, geometry: geom };
                }
                return row;
            });
        }
        if (!replaced) {
            newRoads = newRoads.concat([
                { request_id: rid, category: cat, geometry: geom },
            ]);
        }
        syncMapLayers();
    }

    function refresh() {
        if (loadPromise) {
            return loadPromise;
        }
        loadPromise = fetch(API_URL, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
        })
            .then(function (resp) {
                return resp.json().then(function (data) {
                    return { ok: resp.ok, data: data };
                });
            })
            .then(function (result) {
                if (result.ok && result.data && result.data.success) {
                    applyPayload(result.data);
                }
            })
            .catch(function () {})
            .finally(function () {
                loadPromise = null;
            });
        return loadPromise;
    }

    function scheduleRefresh(delayMs) {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(function () {
            refreshTimer = null;
            refresh();
        }, typeof delayMs === 'number' ? delayMs : 250);
    }

    function hookMap(map) {
        if (!map || mapHooked) {
            return;
        }
        mapHooked = true;

        function onMapReady() {
            syncMapLayers();
            refresh();
        }

        if (map.loaded && map.loaded()) {
            onMapReady();
        } else {
            map.once('load', onMapReady);
        }

        map.on('style.load', function () {
            syncMapLayers();
        });
        map.on('idle', function () {
            if (
                !map.getSource(SOURCE_ID) ||
                !map.getLayer(LAYER_LINE_ID) ||
                !map.getLayer(LAYER_LABEL_ID)
            ) {
                syncMapLayers();
                return;
            }
            setPendingLayersVisibility(map, !focusedReviewActive);
            bringPendingLayersToFront(map);
        });
    }

    function init() {
        var map = getMap();
        if (!map) {
            setTimeout(init, 200);
            return;
        }
        hookMap(map);

        global.addEventListener('pendingRoadLocks:refresh', function () {
            scheduleRefresh(100);
        });
        global.addEventListener('map:selectionChanged', syncPendingBanner);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                scheduleRefresh(0);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.PendingRoadLocks = {
        isRoadLocked: isRoadLocked,
        assertRoadEditable: assertRoadEditable,
        assertNewRoadDrawable: assertNewRoadDrawable,
        resolveContextRoadId: resolveContextRoadId,
        syncPendingBanner: syncPendingBanner,
        upsertOptimisticNewRoad: upsertOptimisticNewRoad,
        setFocusedReviewActive: setFocusedReviewActive,
    };
})(typeof window !== 'undefined' ? window : this);
