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

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function escapeHtmlText(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeHtmlAttr(value) {
        return escapeHtmlText(value).replace(/'/g, '&#39;');
    }

    /** Escape a localized tip, then splice in trusted HTML for {token} placeholders. */
    function tipHtml(key, fallback, tokens) {
        var text = escapeHtmlText(uiT(key, fallback));
        if (!tokens) {
            return text;
        }
        Object.keys(tokens).forEach(function (token) {
            text = text.split('{' + token + '}').join(tokens[token]);
        });
        return text;
    }
    var GHOST_SOURCE_ID = 'road-geometry-original-ghost-source';
    var GHOST_LAYER_ID = 'road-geometry-original-ghost-line';

    function getMap() {
        return typeof map !== 'undefined' ? map : null;
    }

    function extractEditableCoordsWgs84(geom) {
        if (window.GeometryNormalize && window.GeometryNormalize.extractEditableLineCoordsWgs84) {
            return window.GeometryNormalize.extractEditableLineCoordsWgs84(geom);
        }
        return null;
    }

    function normalizeGeometry(geom) {
        if (window.GeometryNormalize && window.GeometryNormalize.normalizeToLineStringGeometry) {
            return window.GeometryNormalize.normalizeToLineStringGeometry(geom);
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
        } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentFeatureLabel === 'function') {
            label = window.lineDrawingHandler.getCurrentFeatureLabel();
        }
        return label;
    }

    function paintNewLegendSwatch() {
        var host = document.getElementById('road-geometry-new-legend-swatch');
        if (!host) {
            return;
        }

        var label = currentFeatureLabel() || 'Line';

        var closed = false;
        try {
            if (typeof window.getCurrentRoadClosure === 'function') {
                closed = !!window.getCurrentRoadClosure();
            }
        } catch (e0) {}

        var closureKey = (window.RoadClosure && window.RoadClosure.FEATURE_LABEL) || 'Road Closure';
        var style = null;
        if (typeof window.getVisualizationStyle === 'function') {
            style = closed
                ? window.getVisualizationStyle(closureKey) || window.getVisualizationStyle(label)
                : window.getVisualizationStyle(label);
        }

        while (host.firstChild) {
            host.removeChild(host.firstChild);
        }

        if (!style) {
            var fb = document.createElement('span');
            fb.className = 'rge-legend__line rge-legend__line--fallback';
            host.appendChild(fb);
            return;
        }

        var color = style.lineColor || '#0f2d53';
        var w = Number(style.lineWidth) || 4;
        var wSvg = Math.max(2, Math.min(7, w * 0.38));

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'rge-legend__swatch-svg');
        svg.setAttribute('viewBox', '0 0 72 12');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');

        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '2');
        line.setAttribute('y1', '6');
        line.setAttribute('x2', '70');
        line.setAttribute('y2', '6');
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', String(wSvg));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('fill', 'none');

        var dash = style.lineDasharray;
        if (dash && Array.isArray(dash) && dash.length >= 2) {
            var a = Number(dash[0]);
            var b = Number(dash[1]);
            if (isFinite(a) && isFinite(b) && a > 0) {
                line.setAttribute('stroke-dasharray', a * 0.35 + ' ' + b * 0.35);
            }
        }

        svg.appendChild(line);
        host.appendChild(svg);
    }

    function pushMapVisualizationOnly() {
        var lineGeom = buildLineStringGeoJson();
        if (!lineGeom) {
            return;
        }
        if (typeof window.setSelectedOverlayGeometry === 'function') {
            window.setSelectedOverlayGeometry(lineGeom);
        }
        if (roadId != null && window.lineDrawingHandler && typeof window.lineDrawingHandler.updateRiyadhRoadVisualization === 'function') {
            window.lineDrawingHandler.updateRiyadhRoadVisualization(roadId, currentFeatureLabel(), lineGeom);
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

    function getStateSnapshot() {
        if (!workingCoords || workingCoords.length < 2 || roadId == null) {
            return null;
        }
        return {
            roadId: roadId,
            coords: workingCoords.map(function(c) {
                return [Number(c[0]), Number(c[1])];
            })
        };
    }

    function applyStateSnapshot(state) {
        if (!state || !Array.isArray(state.coords) || state.coords.length < 2) {
            return;
        }
        if (roadId == null) {
            return;
        }
        if (state.roadId != null && String(state.roadId) !== String(roadId)) {
            return;
        }

        workingCoords = state.coords.map(function(c) {
            return [Number(c[0]), Number(c[1])];
        });
        cancelScheduledVisualSync();
        pushStateToGlobals();
        rebuildMarkers();
    }

    function recordGeometryEditCheckpoint() {
        if (window.mapEditUndo && typeof window.mapEditUndo.recordBeforeEdit === 'function') {
            window.mapEditUndo.recordBeforeEdit();
        }
    }

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

        paintNewLegendSwatch();
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
    }

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
        var coords = extractEditableCoordsWgs84(norm);
        if (!coords || coords.length < 2) {
            return;
        }
        var lineGeom = { type: 'LineString', coordinates: coords };
        var beforeId = null;
        try {
            var mlsSel = window.MapLineSelection;
            var overlayOutlineId = mlsSel ? mlsSel.OVERLAY_OUTLINE_LAYER_ID : null;
            var overlayLineId = mlsSel ? mlsSel.OVERLAY_LINE_LAYER_ID : null;
            if (mapRef.getLayer(overlayOutlineId)) {
                beforeId = overlayOutlineId;
            } else if (mapRef.getLayer(overlayLineId)) {
                beforeId = overlayLineId;
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
                    'line-color': '#94a3b8',
                    'line-width': 2,
                    'line-opacity': 0.42,
                    'line-dasharray': [2.2, 2.4]
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

        var expanded = readLegendExpandedDefault();

        hintElement = document.createElement('aside');
        hintElement.className =
            'road-geometry-edit-hint' + (expanded ? '' : ' road-geometry-edit-hint--collapsed');
        hintElement.setAttribute(
            'aria-label',
            uiT('reshape_guide_aria', 'Reshape guide')
        );

        var chevronSvg =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M6 9l6 6 6-6"/>' +
            '</svg>';
        var tipAdd = tipHtml('reshape_tip_add', 'Tap {plus} to add a point', {
            plus: '<span class="rge-tips__plus">+</span>'
        });
        var tipRemove = tipHtml(
            'reshape_tip_remove',
            '{shift} + click a point to remove',
            { shift: '<kbd>Shift</kbd>' }
        );

        hintElement.innerHTML =
            '<div class="rge-card">' +
            '<button type="button" class="rge-card__toggle" aria-expanded="' +
            (expanded ? 'true' : 'false') +
            '" aria-controls="road-geometry-edit-hint-body" title="' +
            escapeHtmlAttr(uiT('reshape_guide_toggle_title', 'Show or hide reshape tips')) +
            '">' +
            '<span class="rge-card__title">' +
            escapeHtmlText(uiT('tool_reshape_road', 'Reshape')) +
            '</span>' +
            '<span class="rge-card__chev" aria-hidden="true">' +
            chevronSvg +
            '</span>' +
            '</button>' +
            '<div id="road-geometry-edit-hint-body" class="rge-card__body">' +
            '<div class="rge-legend" role="list">' +
            '<div class="rge-legend__item" role="listitem">' +
            '<span class="rge-legend__sample"><span class="rge-legend__line rge-legend__line--before"></span></span>' +
            '<span class="rge-legend__label">' +
            escapeHtmlText(uiT('reshape_legend_before', 'Before')) +
            '</span>' +
            '</div>' +
            '<div class="rge-legend__item" role="listitem">' +
            '<span class="rge-legend__sample" id="road-geometry-new-legend-swatch"></span>' +
            '<span class="rge-legend__label">' +
            escapeHtmlText(uiT('reshape_legend_editing', 'Editing')) +
            '</span>' +
            '</div>' +
            '</div>' +
            '<ul class="rge-tips">' +
            '<li>' +
            escapeHtmlText(uiT('reshape_tip_drag', 'Drag points to move the road')) +
            '</li>' +
            '<li>' +
            tipAdd +
            '</li>' +
            '<li>' +
            tipRemove +
            '</li>' +
            '</ul>' +
            '</div>' +
            '</div>';

        container.appendChild(hintElement);

        paintNewLegendSwatch();

        var toggleBtn = hintElement.querySelector('.rge-card__toggle');
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
        el.setAttribute(
            'aria-label',
            uiT(
                'reshape_point_aria',
                'Point {n}. Drag to move. Shift+click to remove.'
            ).replace('{n}', String(markerIndex + 1))
        );

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
                if (window.notify && typeof window.notify.tryShow === 'function') {
                    window.notify.tryShow(
                        uiT('toast_need_two_points', 'Need at least two points'),
                        'warning'
                    );
                }
                return;
            }
            recordGeometryEditCheckpoint();
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
        btn.title = uiT('reshape_add_point', 'Add point');
        btn.setAttribute(
            'aria-label',
            uiT('reshape_add_point_aria', 'Add a point on this segment')
        );

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
            recordGeometryEditCheckpoint();
            workingCoords.splice(segIndex + 1, 0, mid);
            cancelScheduledVisualSync();
            pushStateToGlobals();
            rebuildMarkers();
        });
        return btn;
    }

    function markerBaseOptions() {
        return { pitchAlignment: 'map', rotationAlignment: 'map' };
    }

    function setMidpointHandlesFaded(faded) {
        midpointMarkers.forEach(function(mm) {
            try {
                var elMp = mm.getElement();
                if (!elMp) {
                    return;
                }
                elMp.classList.toggle('road-midpoint-handle--faded', !!faded);
            } catch (e) {}
        });
    }

    function setMapCursor(cursor) {
        if (!mapInstance || !mapInstance.getCanvas) {
            return;
        }
        try {
            mapInstance.getCanvas().style.cursor = cursor || '';
        } catch (e) {}
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
                var el = createMidpointElement(segmentIndex);
                var mm = new maplibregl.Marker(Object.assign({
                    element: el,
                    draggable: false
                }, markerBaseOptions()))
                    .setLngLat({
                        lng: (a[0] + b[0]) / 2,
                        lat: (a[1] + b[1]) / 2
                    })
                    .addTo(mapInstance);
                midpointMarkers.push(mm);
            })(seg);
        }

        workingCoords.forEach(function(coord, index) {
            var el = createVertexHandleElement(index);
            var marker = new maplibregl.Marker(Object.assign({
                element: el,
                draggable: true
            }, markerBaseOptions()))
                .setLngLat({ lng: Number(coord[0]), lat: Number(coord[1]) })
                .addTo(mapInstance);

            marker.on('dragstart', function() {
                recordGeometryEditCheckpoint();
                el.classList.add('road-vertex-handle--dragging');
                setMapCursor('grabbing');
                cancelScheduledVisualSync();
                setMidpointHandlesFaded(true);
            });
            marker.on('drag', function() {
                var ll = marker.getLngLat();
                workingCoords[index][0] = ll.lng;
                workingCoords[index][1] = ll.lat;
                scheduleMapVisualizationSync();
            });
            marker.on('dragend', function() {
                el.classList.remove('road-vertex-handle--dragging');
                setMapCursor('');
                var ll = marker.getLngLat();
                workingCoords[index][0] = ll.lng;
                workingCoords[index][1] = ll.lat;
                cancelScheduledVisualSync();
                pushStateToGlobals();
                rebuildMarkers();
            });

            vertexMarkers.push(marker);
        });
    }

    function stop() {
        var preserveMvtHide = !!window.__riyadhPostSaveOverlayActive;
        cancelScheduledVisualSync();
        removeEditHint();
        var mapRef = mapInstance;
        removeOriginalGhostLayer(mapRef);
        if (!preserveMvtHide) {
            try {
                window.__roadGeometryEditActiveId = null;
            } catch (e0) {}
        }
        if (
            !window.__riyadhRoadSuppressMapPaint &&
            typeof window.reapplyRiyadhRoadLayerPaintStates === 'function'
        ) {
            window.reapplyRiyadhRoadLayerPaintStates();
        }
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

        if (!preserveMvtHide && typeof window.syncRiyadhRoadMapOverlayFromContext === 'function') {
            window.syncRiyadhRoadMapOverlayFromContext();
        }
        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
        }
    }

    function startFromRiyadhContext() {
        stop();

        if (typeof window.isMapEditModeActive === 'function' && !window.isMapEditModeActive()) {
            return;
        }

        var ctx = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
        if (!ctx || !ctx.is_riyadh_road || !ctx.geometry) {
            return;
        }

        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.assertRoadEditable === 'function' &&
            typeof window.PendingRoadLocks.resolveContextRoadId === 'function'
        ) {
            var lockId = window.PendingRoadLocks.resolveContextRoadId(ctx);
            if (lockId != null && !window.PendingRoadLocks.assertRoadEditable(lockId)) {
                return;
            }
        }

        mapInstance = getMap();
        if (!mapInstance) {
            return;
        }

        var norm = normalizeGeometry(ctx.geometry);
        if (!norm) {
            if (window.notify && typeof window.notify.tryShow === 'function') {
                window.notify.tryShow(
                    uiT('toast_bad_geometry', "Can't edit this geometry."),
                    'error'
                );
            }
            return;
        }

        workingCoords = extractEditableCoordsWgs84(norm);
        if (!workingCoords) {
            if (window.notify && typeof window.notify.tryShow === 'function') {
                window.notify.tryShow(
                    uiT('toast_wrong_coords', "Can't edit. Coordinates look wrong."),
                    'error'
                );
            }
            return;
        }
        roadId = ctx.riyadh_road_id != null ? ctx.riyadh_road_id : ctx.id;

        showEditHint();
        try {
            window.__roadGeometryEditActiveId = roadId;
        } catch (eR) {}
        pushStateToGlobals();
        if (typeof window.reapplyRiyadhRoadLayerPaintStates === 'function') {
            window.reapplyRiyadhRoadLayerPaintStates();
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
                recordGeometryEditCheckpoint();
                workingCoords.splice(ins.index, 0, ins.point);
                pushStateToGlobals();
                rebuildMarkers();
            }
        };
        mapInstance.on('dblclick', dblClickHandler);

        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
        }
    }

    window.roadGeometryEdit = {
        startFromRiyadhContext: startFromRiyadhContext,
        stop: stop,
        getStateSnapshot: getStateSnapshot,
        applyStateSnapshot: applyStateSnapshot
    };

    window.refreshRoadShapeLegendSwatch = paintNewLegendSwatch;

    if (!window.__roadShapeLegendCatalogListener) {
        window.__roadShapeLegendCatalogListener = true;
        window.addEventListener('symbology:catalogLoaded', function() {
            paintNewLegendSwatch();
        });
    }
})();
