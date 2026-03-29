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

    function showEditHint() {
        removeEditHint();
        var container = document.getElementById('mapContainer');
        if (!container || !mapInstance) {
            return;
        }
        try {
            mapInstance.getContainer().classList.add('road-geometry-edit-active');
        } catch (e) {}

        hintElement = document.createElement('div');
        hintElement.className = 'road-geometry-edit-hint';
        hintElement.setAttribute('role', 'status');
        hintElement.innerHTML =
            '<div class="road-geometry-edit-hint__inner">' +
            '<span class="road-geometry-edit-hint__badge">Shape edit</span>' +
            '<span class="road-geometry-edit-hint__sep" aria-hidden="true"></span>' +
            '<span class="road-geometry-edit-hint__item"><span class="road-geometry-edit-hint__kbd">Drag</span> nodes</span>' +
            '<span class="road-geometry-edit-hint__item"><span class="road-geometry-edit-hint__icon-plus" aria-hidden="true">+</span> on segment adds</span>' +
            '<span class="road-geometry-edit-hint__item"><span class="road-geometry-edit-hint__kbd">Shift</span>+click removes</span>' +
            '</div>';
        container.appendChild(hintElement);
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
        removeAllMarkers();
        workingCoords = null;
        roadId = null;

        if (mapInstance && dblClickHandler) {
            try {
                mapInstance.off('dblclick', dblClickHandler);
            } catch (e) {}
            dblClickHandler = null;
        }

        if (mapInstance && doubleClickZoomWasEnabled) {
            try {
                if (mapInstance.doubleClickZoom && mapInstance.doubleClickZoom.enable) {
                    mapInstance.doubleClickZoom.enable();
                }
            } catch (e2) {}
        }
        doubleClickZoomWasEnabled = false;
        mapInstance = null;
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
