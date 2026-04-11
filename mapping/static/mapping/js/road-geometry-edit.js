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

        var style = null;
        if (typeof window.getVisualizationStyle === 'function') {
            if (closed) {
                style = window.getVisualizationStyle('Road Closure');
            }
            if (!style) {
                style = window.getVisualizationStyle(label);
            }
        }
        if (!style && window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
            var sbl = window.symbologyCatalog.styles_by_label;
            style = (closed && sbl['Road Closure']) ? sbl['Road Closure'] : (sbl[label] || sbl['Line']);
        }

        while (host.firstChild) {
            host.removeChild(host.firstChild);
        }

        if (!style) {
            var fb = document.createElement('span');
            fb.className = 'road-geometry-edit-hint__strip-line road-geometry-edit-hint__strip-line--fallback';
            host.appendChild(fb);
            return;
        }

        var color = style.lineColor || '#64748b';
        var w = Number(style.lineWidth) || 4;
        var wSvg = Math.max(2.2, Math.min(9, w * 0.42));

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'road-geometry-edit-hint__strip-swatch-svg');
        svg.setAttribute('viewBox', '0 0 120 16');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');

        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('y1', '8');
        line.setAttribute('x2', '120');
        line.setAttribute('y2', '8');
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', String(wSvg));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('fill', 'none');

        var dash = style.lineDasharray;
        if (dash && Array.isArray(dash) && dash.length >= 2) {
            var a = Number(dash[0]);
            var b = Number(dash[1]);
            if (isFinite(a) && isFinite(b) && a > 0) {
                line.setAttribute('stroke-dasharray', a * 0.42 + ' ' + b * 0.42);
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
        if (mapInstance && mapInstance.getContainer) {
            try {
                mapInstance.getContainer().classList.remove('road-geometry-edit-active');
            } catch (e) {}
        }
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
            var mlsSel = typeof window.MapLineSelection !== 'undefined' ? window.MapLineSelection : null;
            var overlayOutlineId = (mlsSel && mlsSel.OVERLAY_OUTLINE_LAYER_ID) || 'selected-road-overlay-outline';
            var overlayLineId = (mlsSel && mlsSel.OVERLAY_LINE_LAYER_ID) || 'selected-road-overlay-line';
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
                    'line-color': '#64748b',
                    'line-width': 2.5,
                    'line-opacity': 0.55,
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

        hintElement.innerHTML =
            '<div class="road-geometry-edit-hint__panel">' +
            '<button type="button" class="road-geometry-edit-hint__toggle" aria-expanded="' +
            (expanded ? 'true' : 'false') +
            '" aria-controls="road-geometry-edit-hint-body" title="Show or hide editing guide">' +
            '<span class="road-geometry-edit-hint__toggle-main">' +
            '<span class="road-geometry-edit-hint__titles">' +
            '<span class="road-geometry-edit-hint__title">Road shape</span>' +
            '<span class="road-geometry-edit-hint__subtitle">Original vs new</span>' +
            '</span>' +
            '</span>' +
            '<span class="road-geometry-edit-hint__chev">' +
            chevronSvg +
            '</span>' +
            '</button>' +
            '<div id="road-geometry-edit-hint-body" class="road-geometry-edit-hint__body">' +
            '<div class="road-geometry-edit-hint__strip">' +
            '<div class="road-geometry-edit-hint__strip-item">' +
            '<div class="road-geometry-edit-hint__strip-line-wrap">' +
            '<span class="road-geometry-edit-hint__strip-line road-geometry-edit-hint__strip-line--ghost"></span>' +
            '</div>' +
            '<span class="road-geometry-edit-hint__strip-label">Original</span>' +
            '</div>' +
            '<div class="road-geometry-edit-hint__strip-item">' +
            '<div class="road-geometry-edit-hint__strip-line-wrap">' +
            '<span id="road-geometry-new-legend-swatch" class="road-geometry-edit-hint__strip-swatch"></span>' +
            '</div>' +
            '<span class="road-geometry-edit-hint__strip-label">New</span>' +
            '</div>' +
            '</div>' +
            '<p class="road-geometry-edit-hint__note"><strong>Dashed line:</strong> published geometry on the network. <strong>Colored line:</strong> your new shape.</p>' +
            '<p class="road-geometry-edit-hint__actions-heading">On the map</p>' +
            '<ul class="road-geometry-edit-hint__list">' +
            '<li><span class="road-geometry-edit-hint__ic road-geometry-edit-hint__ic--drag" aria-hidden="true"></span><span class="road-geometry-edit-hint__list-text">Drag nodes to move the line</span></li>' +
            '<li><span class="road-geometry-edit-hint__ic road-geometry-edit-hint__ic--plus" aria-hidden="true">+</span><span class="road-geometry-edit-hint__list-text">Click <kbd class="road-geometry-edit-hint__kbd-inline">+</kbd> on a segment to add a node</span></li>' +
            '<li><span class="road-geometry-edit-hint__ic road-geometry-edit-hint__ic--shift" aria-hidden="true"><kbd class="road-geometry-edit-hint__kbd-chip">Shift</kbd></span><span class="road-geometry-edit-hint__list-text">+click a node to remove it</span></li>' +
            '</ul>' +
            '</div>' +
            '</div>';

        container.appendChild(hintElement);

        paintNewLegendSwatch();

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
        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
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
        if (!norm) {
            if (typeof window.showToastNotification === 'function') {
                window.showToastNotification('Cannot edit this road: geometry is missing or unsupported.', 'error');
            }
            return;
        }

        workingCoords = extractEditableCoordsWgs84(norm);
        if (!workingCoords) {
            if (typeof window.showToastNotification === 'function') {
                window.showToastNotification('Cannot edit this road: geometry must be WGS84 (lng/lat).', 'error');
            }
            return;
        }
        roadId = ctx.riyadh_road_id != null ? ctx.riyadh_road_id : ctx.id;

        showEditHint();
        try {
            window.__roadGeometryEditActiveId = roadId;
        } catch (eR) {}
        pushStateToGlobals();
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

        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
        }
    }

    window.roadGeometryEdit = {
        startFromRiyadhContext: startFromRiyadhContext,
        stop: stop
    };

    window.refreshRoadShapeLegendSwatch = paintNewLegendSwatch;

    if (!window.__roadShapeLegendCatalogListener) {
        window.__roadShapeLegendCatalogListener = true;
        window.addEventListener('symbology:catalogLoaded', function() {
            paintNewLegendSwatch();
        });
    }
})();
