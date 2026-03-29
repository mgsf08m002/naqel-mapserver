// Draggable vertices for Riyadh road geometry — polished UX, rAF-throttled map sync.
(function() {
    'use strict';

    var vertexMarkers = [];
    var midpointMarkers = [];
    var workingCoords = null;
    var roadId = null;
    var mapInstance = null;
    var dblClickHandler = null;
    var doubleClickZoomWasEnabled = false;
    var hintElement = null;
    var visualRafId = null;
    var LEGEND_EXPANDED_KEY = 'roadGeometryEditLegendOpen';

    function readLegendExpandedDefault() {
        try {
            var v = localStorage.getItem(LEGEND_EXPANDED_KEY);
            if (v === '1') {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function persistLegendExpanded(expanded) {
        try {
            localStorage.setItem(LEGEND_EXPANDED_KEY, expanded ? '1' : '0');
        } catch (e) {}
    }
    var GHOST_SOURCE_ID = 'road-geometry-original-ghost-source';
    var GHOST_LAYER_ID = 'road-geometry-original-ghost-line';

    function getMap() {
        return typeof map !== 'undefined' ? map : null;
    }

    function webMercatorToWgs84(x, y) {
        var R = 6378137.0;
        var lng = (x / R) * (180 / Math.PI);
        var lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
        return [lng, lat];
    }

    function normalizeLineStringCoordsForMap(coords) {
        if (!coords || coords.length < 2) {
            return null;
        }
        var cleaned = [];
        var i;
        for (i = 0; i < coords.length; i++) {
            var coord = coords[i];
            if (!coord || coord.length < 2) {
                return null;
            }
            var lng = Number(coord[0]);
            var lat = Number(coord[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                return null;
            }
            if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
                var converted = webMercatorToWgs84(lng, lat);
                lng = converted[0];
                lat = converted[1];
            }
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                return null;
            }
            if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
                return null;
            }
            cleaned.push([lng, lat]);
        }
        if (cleaned.length < 2) {
            return null;
        }
        function bboxCenter(cc) {
            var minLng = cc[0][0];
            var minLat = cc[0][1];
            var maxLng = cc[0][0];
            var maxLat = cc[0][1];
            cc.forEach(function(pt) {
                minLng = Math.min(minLng, pt[0]);
                minLat = Math.min(minLat, pt[1]);
                maxLng = Math.max(maxLng, pt[0]);
                maxLat = Math.max(maxLat, pt[1]);
            });
            return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
        }
        function inRiyadhViewport(lng, lat) {
            return lng >= 45.475 && lng <= 48.733 && lat >= 23.981 && lat <= 25.664;
        }
        var center = bboxCenter(cleaned);
        if (!inRiyadhViewport(center.lng, center.lat) && inRiyadhViewport(center.lat, center.lng)) {
            for (i = 0; i < cleaned.length; i++) {
                var pt = cleaned[i];
                cleaned[i] = [pt[1], pt[0]];
            }
        }
        return cleaned;
    }

    function normalizeGeometry(geom) {
        if (window.lineDrawingHandler && window.lineDrawingHandler.normalizeToLineStringGeometry) {
            return window.lineDrawingHandler.normalizeToLineStringGeometry(geom);
        }
        return null;
    }

    function buildLineStringGeoJson() {
        if (!workingCoords || workingCoords.length < 2) {
            return null;
        }
        return {
            type: 'LineString',
            coordinates: workingCoords.map(function(c) {
                return [Number(c[0]), Number(c[1])];
            })
        };
    }

    function currentFeatureLabel() {
        var label = 'Line';
        if (window.approvedLineBeingEdited) {
            label = window.approvedLineBeingEdited.current_feature_label
                || window.approvedLineBeingEdited.feature_type
                || label;
        } else if (typeof window.getCurrentFeatureLabel === 'function') {
            label = window.getCurrentFeatureLabel();
        }
        return label;
    }

    /** Map layers + midpoint handle positions (keeps + buttons on segments while dragging). */
    function pushMapVisualizationOnly() {
        var lineGeom = buildLineStringGeoJson();
        if (!lineGeom) {
            return;
        }
        if (typeof window.setSelectedOverlayGeometry === 'function') {
            window.setSelectedOverlayGeometry(lineGeom);
        }
        if (typeof window.updateRiyadhRoadVisualization === 'function' && roadId != null) {
            window.updateRiyadhRoadVisualization(roadId, currentFeatureLabel(), lineGeom);
        }
        var mi;
        if (workingCoords && midpointMarkers.length === workingCoords.length - 1) {
            for (mi = 0; mi < midpointMarkers.length; mi++) {
                var a = workingCoords[mi];
                var b = workingCoords[mi + 1];
                try {
                    midpointMarkers[mi].setLngLat({
                        lng: (a[0] + b[0]) / 2,
                        lat: (a[1] + b[1]) / 2
                    });
                } catch (e) {}
            }
        }
    }

    function cancelScheduledVisualSync() {
        if (visualRafId != null) {
            cancelAnimationFrame(visualRafId);
            visualRafId = null;
        }
    }

    function scheduleMapVisualizationSync() {
        if (visualRafId != null) {
            return;
        }
        visualRafId = requestAnimationFrame(function() {
            visualRafId = null;
            pushMapVisualizationOnly();
        });
    }

    /** Full sync: data models, DOM attributes, side-panel preview. */
    function pushStateToGlobals() {
        var lineGeom = buildLineStringGeoJson();
        if (!lineGeom) {
            return;
        }

        if (window.approvedLineBeingEdited) {
            window.approvedLineBeingEdited = Object.assign({}, window.approvedLineBeingEdited, {
                geometry: lineGeom
            });
        }
        if (window.selectedRiyadhRoad) {
            window.selectedRiyadhRoad = Object.assign({}, window.selectedRiyadhRoad, {
                geometry: lineGeom
            });
        }

        var editScreen = document.getElementById('editFeatureScreen');
        if (editScreen) {
            editScreen.setAttribute('data-request-geometry', JSON.stringify(lineGeom));
        }

        pushMapVisualizationOnly();

        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateFeatureTypeVisualization === 'function') {
            window.lineDrawingHandler.updateFeatureTypeVisualization();
        }
    }

    function removeAllMarkers() {
        vertexMarkers.forEach(function(m) {
            try {
                m.remove();
            } catch (e) {}
        });
        vertexMarkers = [];
        midpointMarkers.forEach(function(m) {
            try {
                m.remove();
            } catch (e) {}
        });
        midpointMarkers = [];
    }

    function removeEditHint() {
        if (hintElement && hintElement.parentNode) {
            hintElement.parentNode.removeChild(hintElement);
        }
        hintElement = null;
        if (mapInstance && mapInstance.getContainer) {
            try {
                mapInstance.getContainer().classList.remove('road-geometry-edit-active');
            } catch (e) {}
        }
    }

    /** Snapshot-only reference line (server state). Stays fixed while the cyan overlay moves. */
    function removeOriginalGhostLayer(mapRef) {
        var m = mapRef || mapInstance;
        if (!m) {
            return;
        }
        try {
            if (m.getLayer(GHOST_LAYER_ID)) {
                m.removeLayer(GHOST_LAYER_ID);
            }
            if (m.getSource(GHOST_SOURCE_ID)) {
                m.removeSource(GHOST_SOURCE_ID);
            }
        } catch (e) {}
    }

    function ensureOriginalGhostLayer(mapRef, roadIdKey) {
        removeOriginalGhostLayer(mapRef);
        if (!mapRef || roadIdKey == null) {
            return;
        }
        var st =
            window.riyadhRoadOriginalState &&
            (window.riyadhRoadOriginalState[String(roadIdKey)] ||
                window.riyadhRoadOriginalState[roadIdKey]);
        if (!st || !st.geometry) {
            return;
        }
        var norm = normalizeGeometry(st.geometry);
        if (!norm || !norm.coordinates || norm.coordinates.length < 2) {
            return;
        }
        var raw = norm.coordinates.map(function(c) {
            return [Number(c[0]), Number(c[1])];
        });
        var coords = normalizeLineStringCoordsForMap(raw);
        if (!coords || coords.length < 2) {
            return;
        }
        var lineGeom = { type: 'LineString', coordinates: coords };
        var beforeId = null;
        try {
            if (mapRef.getLayer('selected-road-overlay-glow')) {
                beforeId = 'selected-road-overlay-glow';
            } else if (mapRef.getLayer('selected-road-overlay-line')) {
                beforeId = 'selected-road-overlay-line';
            }
            mapRef.addSource(GHOST_SOURCE_ID, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: lineGeom,
                    properties: { kind: 'original-snapshot' }
                }
            });
            var layerDef = {
                id: GHOST_LAYER_ID,
                type: 'line',
                source: GHOST_SOURCE_ID,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#475569',
                    'line-width': 2.5,
                    'line-opacity': 0.48,
                    'line-dasharray': [1.25, 2]
                }
            };
            if (beforeId) {
                mapRef.addLayer(layerDef, beforeId);
            } else {
                mapRef.addLayer(layerDef);
            }
        } catch (e2) {}
    }

    function showEditHint() {
        removeEditHint();
        var container = document.getElementById('mapContainer');
        if (!container || !mapInstance) {
            return;
        }
        try {
            mapInstance.getContainer().classList.add('road-geometry-edit-active');
        } catch (e) {}

        var expanded = readLegendExpandedDefault();

        hintElement = document.createElement('aside');
        hintElement.className =
            'road-geometry-edit-hint' + (expanded ? '' : ' road-geometry-edit-hint--collapsed');
        hintElement.setAttribute('aria-label', 'Geometry editing guide');

        var chevronSvg =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M6 9l6 6 6-6"/>' +
            '</svg>';
        var lineIconSvg =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
            '<path d="M4 12c2.5-4 6-6 8-2s5 4 8-2"/>' +
            '<circle cx="7" cy="11" r="1.5" fill="currentColor" stroke="none"/>' +
            '<circle cx="17" cy="13" r="1.5" fill="currentColor" stroke="none"/>' +
            '</svg>';

        hintElement.innerHTML =
            '<div class="road-geometry-edit-hint__panel">' +
            '<button type="button" class="road-geometry-edit-hint__toggle" aria-expanded="' +
            (expanded ? 'true' : 'false') +
            '" aria-controls="road-geometry-edit-hint-body" title="Show or hide editing guide">' +
            '<span class="road-geometry-edit-hint__toggle-main">' +
            '<span class="road-geometry-edit-hint__icon">' +
            lineIconSvg +
            '</span>' +
            '<span class="road-geometry-edit-hint__titles">' +
            '<span class="road-geometry-edit-hint__title">Shape editing</span>' +
            '<span class="road-geometry-edit-hint__subtitle">Saved vs draft · shortcuts</span>' +
            '</span>' +
            '</span>' +
            '<span class="road-geometry-edit-hint__chev">' +
            chevronSvg +
            '</span>' +
            '</button>' +
            '<div id="road-geometry-edit-hint-body" class="road-geometry-edit-hint__body">' +
            '<div class="road-geometry-edit-hint__strip">' +
            '<div class="road-geometry-edit-hint__strip-item">' +
            '<span class="road-geometry-edit-hint__strip-line road-geometry-edit-hint__strip-line--ghost"></span>' +
            '<span class="road-geometry-edit-hint__strip-label">On network (saved)</span>' +
            '</div>' +
            '<div class="road-geometry-edit-hint__strip-item">' +
            '<span class="road-geometry-edit-hint__strip-line road-geometry-edit-hint__strip-line--edit"></span>' +
            '<span class="road-geometry-edit-hint__strip-label">Your edit (draft)</span>' +
            '</div>' +
            '</div>' +
            '<p class="road-geometry-edit-hint__strip-hint">The dashed path stays fixed as a reference; cyan follows your edits until you save.</p>' +
            '<ul class="road-geometry-edit-hint__list">' +
            '<li><span class="road-geometry-edit-hint__ic road-geometry-edit-hint__ic--drag" aria-hidden="true"></span><span>Drag nodes to move the line</span></li>' +
            '<li><span class="road-geometry-edit-hint__ic road-geometry-edit-hint__ic--plus" aria-hidden="true">+</span><span>Click <strong>+</strong> on a segment to add a node</span></li>' +
            '<li><span class="road-geometry-edit-hint__ic road-geometry-edit-hint__ic--key" aria-hidden="true"><kbd>⇧</kbd></span><span><kbd>Shift</kbd>+click a node to remove it</span></li>' +
            '</ul>' +
            '</div>' +
            '</div>';

        container.appendChild(hintElement);

        var toggleBtn = hintElement.querySelector('.road-geometry-edit-hint__toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function() {
                var collapsed = hintElement.classList.toggle('road-geometry-edit-hint--collapsed');
                toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                persistLegendExpanded(!collapsed);
            });
        }
    }

    function projectPointOnSegment(p, a, b) {
        var x = p[0];
        var y = p[1];
        var x1 = a[0];
        var y1 = a[1];
        var x2 = b[0];
        var y2 = b[1];
        var dx = x2 - x1;
        var dy = y2 - y1;
        if (dx === 0 && dy === 0) {
            return [x1, y1];
        }
        var t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        return [x1 + t * dx, y1 + t * dy];
    }

    function segmentDistanceSq(p, a, b) {
        var proj = projectPointOnSegment(p, a, b);
        var dx = p[0] - proj[0];
        var dy = p[1] - proj[1];
        return dx * dx + dy * dy;
    }

    function findInsertionOnLine(coords, click) {
        var bestI = 0;
        var bestD = Infinity;
        var bestPt = null;
        var i;
        for (i = 0; i < coords.length - 1; i++) {
            var d = segmentDistanceSq(click, coords[i], coords[i + 1]);
            if (d < bestD) {
                bestD = d;
                bestI = i;
                bestPt = projectPointOnSegment(click, coords[i], coords[i + 1]);
            }
        }
        return { index: bestI + 1, point: bestPt };
    }

    function createVertexHandleElement(markerIndex) {
        var el = document.createElement('div');
        el.className = 'road-vertex-handle';
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Road node ' + (markerIndex + 1) + ': drag to move, Shift+click to remove');
        el.setAttribute('data-vertex-index', String(markerIndex));

        var dot = document.createElement('span');
        dot.className = 'road-vertex-handle__dot';
        el.appendChild(dot);

        el.addEventListener('click', function(ev) {
            if (!ev.shiftKey) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            if (!workingCoords || workingCoords.length <= 2) {
                if (typeof window.showToastNotification === 'function') {
                    window.showToastNotification('A line needs at least two vertices.', 'warning');
                }
                return;
            }
            workingCoords.splice(markerIndex, 1);
            cancelScheduledVisualSync();
            pushStateToGlobals();
            rebuildMarkers();
        });
        return el;
    }

    function createMidpointElement(segIndex) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'road-midpoint-handle';
        btn.title = 'Add vertex on this segment';
        btn.setAttribute('aria-label', 'Add vertex between points ' + (segIndex + 1) + ' and ' + (segIndex + 2));

        var inner = document.createElement('span');
        inner.className = 'road-midpoint-handle__inner';
        inner.setAttribute('aria-hidden', 'true');
        inner.textContent = '+';
        btn.appendChild(inner);

        btn.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!workingCoords || segIndex < 0 || segIndex >= workingCoords.length - 1) {
                return;
            }
            var a = workingCoords[segIndex];
            var b = workingCoords[segIndex + 1];
            var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            workingCoords.splice(segIndex + 1, 0, mid);
            cancelScheduledVisualSync();
            pushStateToGlobals();
            rebuildMarkers();
        });
        return btn;
    }

    function markerBaseOptions() {
        var o = { pitchAlignment: 'map', rotationAlignment: 'map' };
        if (typeof maplibregl !== 'undefined' && maplibregl !== null) {
            return o;
        }
        return {};
    }

    function rebuildMarkers() {
        removeAllMarkers();
        if (!mapInstance || !workingCoords || typeof maplibregl === 'undefined') {
            return;
        }

        var seg;
        for (seg = 0; seg < workingCoords.length - 1; seg++) {
            (function(segmentIndex) {
                var a = workingCoords[segmentIndex];
                var b = workingCoords[segmentIndex + 1];
                var midLng = (a[0] + b[0]) / 2;
                var midLat = (a[1] + b[1]) / 2;
                var el = createMidpointElement(segmentIndex);
                var mm = new maplibregl.Marker(Object.assign({
                    element: el,
                    draggable: false
                }, markerBaseOptions()))
                    .setLngLat({ lng: midLng, lat: midLat })
                    .addTo(mapInstance);
                midpointMarkers.push(mm);
            })(seg);
        }

        workingCoords.forEach(function(coord, index) {
            var el = createVertexHandleElement(index);
            var lng = Number(coord[0]);
            var lat = Number(coord[1]);
            var marker = new maplibregl.Marker(Object.assign({
                element: el,
                draggable: true
            }, markerBaseOptions()))
                .setLngLat({ lng: lng, lat: lat })
                .addTo(mapInstance);

            marker.on('dragstart', function() {
                el.classList.add('road-vertex-handle--dragging');
                if (mapInstance && mapInstance.getCanvas) {
                    try {
                        mapInstance.getCanvas().style.cursor = 'grabbing';
                    } catch (eC) {}
                }
                cancelScheduledVisualSync();
                midpointMarkers.forEach(function(mm) {
                    try {
                        var elMp = mm.getElement();
                        if (elMp) {
                            elMp.classList.add('road-midpoint-handle--faded');
                        }
                    } catch (e) {}
                });
            });
            marker.on('drag', function() {
                var ll = marker.getLngLat();
                workingCoords[index][0] = ll.lng;
                workingCoords[index][1] = ll.lat;
                scheduleMapVisualizationSync();
            });
            marker.on('dragend', function() {
                el.classList.remove('road-vertex-handle--dragging');
                if (mapInstance && mapInstance.getCanvas) {
                    try {
                        mapInstance.getCanvas().style.cursor = '';
                    } catch (eC2) {}
                }
                var ll = marker.getLngLat();
                workingCoords[index][0] = ll.lng;
                workingCoords[index][1] = ll.lat;
                cancelScheduledVisualSync();
                pushMapVisualizationOnly();
                midpointMarkers.forEach(function(mm) {
                    try {
                        var elMp = mm.getElement();
                        if (elMp) {
                            elMp.classList.remove('road-midpoint-handle--faded');
                        }
                    } catch (e2) {}
                });
                pushStateToGlobals();
                rebuildMarkers();
            });

            vertexMarkers.push(marker);
        });
    }

    function stop() {
        cancelScheduledVisualSync();
        removeEditHint();
        var rid = roadId;
        var mapRef = mapInstance;
        removeOriginalGhostLayer(mapRef);
        if (rid != null && typeof window.setRiyadhRoadBasemapHiddenForEdit === 'function') {
            window.setRiyadhRoadBasemapHiddenForEdit(rid, false);
        }
        try {
            window.__roadGeometryEditActiveId = null;
        } catch (e0) {}
        removeAllMarkers();
        workingCoords = null;
        roadId = null;

        if (mapRef && dblClickHandler) {
            try {
                mapRef.off('dblclick', dblClickHandler);
            } catch (e) {}
            dblClickHandler = null;
        }

        if (mapRef && doubleClickZoomWasEnabled) {
            try {
                if (mapRef.doubleClickZoom && mapRef.doubleClickZoom.enable) {
                    mapRef.doubleClickZoom.enable();
                }
            } catch (e2) {}
        }
        doubleClickZoomWasEnabled = false;
        mapInstance = null;

        if (typeof window.syncRiyadhRoadMapOverlayFromContext === 'function') {
            window.syncRiyadhRoadMapOverlayFromContext();
        }
    }

    function startFromRiyadhContext() {
        stop();

        var editScreen = document.getElementById('editFeatureScreen');
        if (editScreen && editScreen.getAttribute('data-geometry-readonly') === 'true') {
            return;
        }

        var ctx = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
        if (!ctx || !ctx.is_riyadh_road || !ctx.geometry) {
            return;
        }

        mapInstance = getMap();
        if (!mapInstance) {
            return;
        }

        var norm = normalizeGeometry(ctx.geometry);
        if (!norm || !norm.coordinates || norm.coordinates.length < 2) {
            return;
        }

        var rawCoords = norm.coordinates.map(function(c) {
            return [Number(c[0]), Number(c[1])];
        });
        workingCoords = normalizeLineStringCoordsForMap(rawCoords);
        if (!workingCoords) {
            return;
        }
        roadId = ctx.riyadh_road_id != null ? ctx.riyadh_road_id : ctx.id;

        showEditHint();
        pushStateToGlobals();
        try {
            window.__roadGeometryEditActiveId = roadId;
        } catch (eR) {}
        if (typeof window.setRiyadhRoadBasemapHiddenForEdit === 'function') {
            window.setRiyadhRoadBasemapHiddenForEdit(roadId, true);
        }
        ensureOriginalGhostLayer(mapInstance, roadId);
        rebuildMarkers();

        if (mapInstance.doubleClickZoom) {
            try {
                if (mapInstance.doubleClickZoom.isEnabled && mapInstance.doubleClickZoom.isEnabled()) {
                    doubleClickZoomWasEnabled = true;
                    mapInstance.doubleClickZoom.disable();
                } else {
                    doubleClickZoomWasEnabled = false;
                }
            } catch (e3) {
                doubleClickZoomWasEnabled = false;
            }
        }

        dblClickHandler = function(e) {
            if (!workingCoords || workingCoords.length < 2) {
                return;
            }
            var target = e.originalEvent && e.originalEvent.target;
            if (target && target.closest && target.closest('.road-vertex-handle, .road-midpoint-handle')) {
                return;
            }
            var p = [e.lngLat.lng, e.lngLat.lat];
            var ins = findInsertionOnLine(workingCoords, p);
            if (ins.point) {
                cancelScheduledVisualSync();
                workingCoords.splice(ins.index, 0, ins.point);
                pushStateToGlobals();
                rebuildMarkers();
            }
        };
        mapInstance.on('dblclick', dblClickHandler);
    }

    window.roadGeometryEdit = {
        startFromRiyadhContext: startFromRiyadhContext,
        stop: stop
    };
})();
