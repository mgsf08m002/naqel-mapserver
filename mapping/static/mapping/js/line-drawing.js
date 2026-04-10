// Line drawing, MapLibre rendering, and sidepanel UI behavior.
(function() {
    'use strict';

    let currentLineId = null;
    let drawInstance = null;
    let selectedLineId = null;
    let vertexMarkers = [];
    let drawingLineId = null;
    let drawingMonitorInterval = null;
    let svgObserver = null;

    let sidePanel = null;
    let sidePanelContent = null;
    let currentFeatureLabel = "Line";

    let symbologyCatalog = null;
    let symbologyStylesByLabel = null;
    let symbologyCatalogRequested = false;

    const RIYADH_FIELD_KEYS_OMIT_FROM_TAGS = {
        name: true,
        road_closure: true,
        common_name: true,
        multilingual_names: true
    };

    /** Shared selection casing helpers; see map-line-selection.js */
    function mapLineSelection() {
        return typeof window.MapLineSelection !== 'undefined' ? window.MapLineSelection : null;
    }

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function notify(message, type) {
        if (!message) {
            return;
        }
        if (window.notify) {
            if (type === 'success' && typeof window.notify.success === 'function') return window.notify.success(message);
            if (type === 'error' && typeof window.notify.error === 'function') return window.notify.error(message);
            if (type === 'warning' && typeof window.notify.warning === 'function') return window.notify.warning(message);
            if (typeof window.notify.info === 'function') return window.notify.info(message);
        }
        if (type === 'error') {
            alert(message);
        }
    }

    function getDeleteTargetFromContext() {
        const riyadh = window.selectedRiyadhRoad || null;
        if (riyadh && riyadh.is_riyadh_road) {
            const id = riyadh.riyadh_road_id != null ? riyadh.riyadh_road_id : riyadh.id;
            if (id != null) {
                return { target_type: 'riyadh_road', target_id: id, snapshot: riyadh };
            }
        }

        return null;
    }

    function getDeleteTargetFromEditScreenOptions(options) {
        const opts = options || {};
        const lineData = opts.lineData || null;

        // If the edit screen was opened for a Riyadh road (tile feature), it should be in the snapshot.
        if (lineData && typeof lineData === 'object' && lineData.is_riyadh_road) {
            const id = lineData.riyadh_road_id != null ? lineData.riyadh_road_id : lineData.id;
            if (id != null) {
                return { target_type: 'riyadh_road', target_id: id, snapshot: lineData };
            }
        }

        return null;
    }

    const SIDE_PANEL_WIDTH_PX = 320;
    let mapSidePanelChromeReady = false;
    let mapSidePanelOpenedOnce = false;

    function syncRiyadhRoadMapOverlayFromContext() {
        try {
            const ext = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
            if (!ext || !ext.is_riyadh_road || !ext.geometry) {
                return;
            }
            const roadId = ext.riyadh_road_id != null ? ext.riyadh_road_id : ext.id;
            const label = ext.current_feature_label || ext.feature_type || 'Line';
            setSelectedOverlayGeometry(ext.geometry);
            updateRiyadhRoadVisualization(roadId, label, ext.geometry);
        } catch (e) {}
    }

    function applyMapSidePanelOpen(open) {
        const sp = document.getElementById('editSidePanel');
        const mc = document.getElementById('mapContainer');
        const collapseBtn = document.getElementById('sidePanelCollapseBtn');
        const expandTab = document.getElementById('sidePanelExpandTab');
        if (!sp || !mc) {
            return;
        }

        window.__mapSidePanelOpen = !!open;
        if (open) {
            mapSidePanelOpenedOnce = true;
        }

        if (open) {
            sp.classList.remove('-translate-x-full');
            sp.style.setProperty('transform', 'translateX(0)', 'important');
            mc.style.marginLeft = SIDE_PANEL_WIDTH_PX + 'px';
            mc.style.width = 'calc(100% - ' + SIDE_PANEL_WIDTH_PX + 'px)';
            if (collapseBtn) {
                collapseBtn.classList.remove('hidden');
            }
            if (expandTab) {
                expandTab.classList.add('hidden');
            }
        } else {
            sp.classList.add('-translate-x-full');
            sp.style.removeProperty('transform');
            mc.style.marginLeft = '0';
            mc.style.width = '100%';
            if (collapseBtn) {
                collapseBtn.classList.add('hidden');
            }
            if (expandTab && mapSidePanelOpenedOnce) {
                expandTab.classList.remove('hidden');
            }
        }

        setTimeout(function() {
            if (typeof map !== 'undefined' && map && map.resize) {
                map.resize();
            }
        }, 320);
    }

    function initMapSidePanelChrome() {
        if (mapSidePanelChromeReady) {
            return;
        }
        const collapseBtn = document.getElementById('sidePanelCollapseBtn');
        const expandTab = document.getElementById('sidePanelExpandTab');
        if (!collapseBtn || !expandTab) {
            return;
        }
        if (collapseBtn.getAttribute('data-sidebar-bound') === '1') {
            mapSidePanelChromeReady = true;
            return;
        }
        collapseBtn.addEventListener('click', function() {
            applyMapSidePanelOpen(false);
            collapseBtn.setAttribute('aria-expanded', 'false');
            expandTab.setAttribute('aria-expanded', 'true');
        });
        expandTab.addEventListener('click', function() {
            applyMapSidePanelOpen(true);
            collapseBtn.setAttribute('aria-expanded', 'true');
            expandTab.setAttribute('aria-expanded', 'false');
        });
        collapseBtn.setAttribute('data-sidebar-bound', '1');
        expandTab.setAttribute('data-sidebar-bound', '1');
        mapSidePanelChromeReady = true;
    }

    function attachRiyadhGeometryEditRow(editScreen, lineData) {
        const existing = document.getElementById('riyadhGeometryEditRow');
        if (existing) {
            existing.remove();
        }

        const readonly = editScreen && editScreen.getAttribute('data-geometry-readonly') === 'true';
        const content = editScreen && editScreen.querySelector('.flex-1.overflow-y-auto');
        if (readonly || !content || !lineData || !lineData.is_riyadh_road) {
            return;
        }

        const row = document.createElement('div');
        row.id = 'riyadhGeometryEditRow';
        row.className = 'border-b border-zinc-200 px-4 py-3 bg-white';

        const wrap = document.createElement('div');
        wrap.className = 'flex items-center justify-between gap-3';
        const copy = document.createElement('div');
        copy.className = 'min-w-0 flex-1';
        const title = document.createElement('p');
        title.className = 'text-xs font-medium text-zinc-800';
        title.textContent = 'Road geometry';
        const sub = document.createElement('p');
        sub.className = 'text-xs text-zinc-500 mt-0.5';
        sub.textContent = 'Turn on to show vertices and edit the line on the map';
        copy.appendChild(title);
        copy.appendChild(sub);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'riyadhGeometryEditToggleBtn';
        btn.className =
            'flex-shrink-0 rounded-lg border border-zinc-300 bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900';
        btn.setAttribute('aria-pressed', 'false');

        function syncGeometryToggleBtn() {
            const ctx = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
            const rid = ctx && (ctx.riyadh_road_id != null ? ctx.riyadh_road_id : ctx.id);
            const active =
                window.__roadGeometryEditActiveId != null &&
                rid != null &&
                Number(window.__roadGeometryEditActiveId) === Number(rid);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.textContent = active ? 'Done editing' : 'Edit shape';
            if (active) {
                btn.classList.add('border-cyan-500', 'bg-cyan-700', 'ring-1', 'ring-cyan-400/40');
            } else {
                btn.classList.remove('border-cyan-500', 'bg-cyan-700', 'ring-1', 'ring-cyan-400/40');
            }
        }

        btn.addEventListener('click', function() {
            if (window.__roadGeometryEditActiveId != null) {
                if (window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
                    window.roadGeometryEdit.stop();
                }
                syncRiyadhRoadMapOverlayFromContext();
            } else if (window.roadGeometryEdit && typeof window.roadGeometryEdit.startFromRiyadhContext === 'function') {
                window.roadGeometryEdit.startFromRiyadhContext();
            }
            setTimeout(syncGeometryToggleBtn, 0);
        });

        wrap.appendChild(copy);
        wrap.appendChild(btn);
        row.appendChild(wrap);

        const first = content.firstElementChild;
        if (first) {
            first.after(row);
        } else {
            content.appendChild(row);
        }

        syncGeometryToggleBtn();
    }

    /** Keep tags_data in sync with fields_data (exclude keys that have their own UI). */
    function normalizeRiyadhRoadTagsFromFields(road) {
        if (!road || !road.is_riyadh_road) {
            return;
        }
        const fd = road.fields_data && typeof road.fields_data === 'object' ? road.fields_data : {};
        road.fields_data = fd;
        const tags = [];
        Object.keys(fd).forEach(function (k) {
            if (RIYADH_FIELD_KEYS_OMIT_FROM_TAGS[k]) {
                return;
            }
            const v = fd[k];
            if (v === undefined || v === null || v === '') {
                return;
            }
            tags.push({ key: k, value: String(v) });
        });
        road.tags_data = tags;
    }

    function updateRiyadhRoadFeatureContextLine(lineData) {
        const el = document.getElementById('riyadhRoadFeatureContextLine');
        if (!el) {
            return;
        }
        if (!lineData || !lineData.is_riyadh_road) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        const fd = lineData.fields_data && typeof lineData.fields_data === 'object' ? lineData.fields_data : {};
        const name = String(fd.name || '').trim();
        const ref = String(fd.ref || '').trim();
        const fclassRaw = String(fd.fclass || '').trim();
        const fclassLower = fclassRaw.toLowerCase();
        const catalog = window.symbologyCatalog || {};
        const fclassToLabel = catalog.riyadh_fclass_to_label && typeof catalog.riyadh_fclass_to_label === 'object'
            ? catalog.riyadh_fclass_to_label
            : null;
        const rawLabel = String(lineData.current_feature_label || lineData.feature_type || '').trim();
        const fclassLabel = fclassRaw
            ? (fclassToLabel && fclassToLabel[fclassLower] ? String(fclassToLabel[fclassLower]) : fclassRaw.replace(/_/g, ' ').replace(/\b\w/g, function(ch) { return ch.toUpperCase(); }))
            : '';
        const parts = [];
        if (name) {
            parts.push(name);
        }
        if (ref) {
            parts.push('Ref ' + ref);
        }
        // Keep sidebar metadata aligned with the human-readable feature label.
        if (fclassLabel && fclassLower !== 'unclassified' && (!rawLabel || rawLabel.toLowerCase() !== fclassLabel.toLowerCase())) {
            parts.push(fclassLabel);
        }
        if (!parts.length) {
            el.textContent = '';
            el.classList.add('hidden');
            return;
        }
        el.textContent = parts.join(' · ');
        el.classList.remove('hidden');
    }

    window.syncRiyadhRoadMapOverlayFromContext = syncRiyadhRoadMapOverlayFromContext;
    window.applyMapSidePanelOpen = applyMapSidePanelOpen;
    window.initMapSidePanelChrome = initMapSidePanelChrome;

    function requestDeleteForCurrentFeature() {
        const target = getDeleteTargetFromContext();
        if (!target) {
            notify('Select a road first.', 'warning');
            return;
        }

        if (!confirm('Are you sure you want to request deletion of this road?')) {
            return;
        }

        const snapshot = target.snapshot || {};
        const payload = {
            target_type: target.target_type,
            target_id: target.target_id,
            geometry: snapshot.geometry || null,
            feature_type: snapshot.feature_type || snapshot.current_feature_label || 'Line',
            current_feature_label: snapshot.current_feature_label || snapshot.feature_type || 'Line',
            fields_data: snapshot.fields_data || {},
            tags_data: snapshot.tags_data || [],
            relations_data: snapshot.relations_data || [],
        };

        fetch('/mapping/api/request/delete/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken'),
            },
            body: JSON.stringify(payload),
        })
            .then(function (resp) { return resp.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    notify((data && data.message) ? data.message : 'Failed to submit delete request.', 'error');
                    return;
                }

                if (data.auto_approved) {
                    notify('Road deleted successfully.', 'success');
                    try {
                        window.selectedRiyadhRoad = null;
                        window.approvedLineBeingEdited = null;
                        setSelectedOverlayGeometry(null);
                        syncRiyadhTileSelectionSuppressionForDraftClosure();
                    } catch (e) {}
                    setTimeout(function () {
                        if (typeof window.triggerRiyadhTilesReload === 'function') {
                            window.triggerRiyadhTilesReload(data.tiles_version);
                        }
                    }, 500);
                } else {
                    notify('Delete request sent for approval.', 'success');
                }
            })
            .catch(function () {
                notify('Failed to submit delete request.', 'error');
            });
    }

    // Selected-feature overlay (GeoJSON): same selection chrome as tile roads / drawn lines.
    const SELECTED_OVERLAY_SOURCE_ID = 'selected-road-overlay-v2';
    const _MLS_OVERLAY = mapLineSelection();
    const SELECTED_OVERLAY_OUTLINE_LAYER_ID =
        (_MLS_OVERLAY && _MLS_OVERLAY.OVERLAY_OUTLINE_LAYER_ID) || 'selected-road-overlay-outline';
    const SELECTED_OVERLAY_RING_LAYER_ID =
        (_MLS_OVERLAY && _MLS_OVERLAY.OVERLAY_RING_LAYER_ID) || 'selected-road-overlay-ring';
    const SELECTED_OVERLAY_GRADIENT_LAYER_ID =
        (_MLS_OVERLAY && _MLS_OVERLAY.OVERLAY_GRADIENT_LAYER_ID) || 'selected-road-overlay-gradient';
    const SELECTED_OVERLAY_LINE_LAYER_ID =
        (_MLS_OVERLAY && _MLS_OVERLAY.OVERLAY_LINE_LAYER_ID) || 'selected-road-overlay-line';

    function ensureSelectedOverlayLayers() {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        if (!map.loaded() || !map.isStyleLoaded()) {
            map.once('load', ensureSelectedOverlayLayers);
            map.once('style.load', ensureSelectedOverlayLayers);
            return;
        }

        try {
            if (!map.getSource(SELECTED_OVERLAY_SOURCE_ID)) {
                map.addSource(SELECTED_OVERLAY_SOURCE_ID, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                });
            }
        } catch (e) {
            return;
        }

        try {
            if (!map.getLayer(SELECTED_OVERLAY_OUTLINE_LAYER_ID)) {
                const mls = mapLineSelection();
                const op = mls ? mls.defaultGeoJsonOutlinePaint() : {
                    'line-color': '#0f172a',
                    'line-width': 11,
                    'line-opacity': 0.93,
                    'line-blur': 0.45,
                };
                map.addLayer({
                    id: SELECTED_OVERLAY_OUTLINE_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: op,
                });
            }
            if (!map.getLayer(SELECTED_OVERLAY_RING_LAYER_ID)) {
                const mls2 = mapLineSelection();
                const rp = mls2 ? mls2.defaultGeoJsonRingPaint() : {
                    'line-color': '#ffffff',
                    'line-width': 8,
                    'line-opacity': 1,
                    'line-blur': 0,
                };
                map.addLayer({
                    id: SELECTED_OVERLAY_RING_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: rp,
                });
            }
            if (!map.getLayer(SELECTED_OVERLAY_GRADIENT_LAYER_ID)) {
                map.addLayer({
                    id: SELECTED_OVERLAY_GRADIENT_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#94a3b8',
                        'line-width': 4,
                        'line-opacity': 0.95,
                    },
                });
            }
            if (!map.getLayer(SELECTED_OVERLAY_LINE_LAYER_ID)) {
                map.addLayer({
                    id: SELECTED_OVERLAY_LINE_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#ffffff',
                        'line-width': 5,
                        /* Hidden until applySelectedOverlaySymbologyPaint (avoids white core flash). */
                        'line-opacity': 0,
                    },
                });
            }

            bringSelectedOverlayLayersToFront();
        } catch (e) {
            // Non-critical
        }
    }

    function setSelectedOverlayGeometry(geometry) {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        ensureSelectedOverlayLayers();
        try {
            const src = map.getSource(SELECTED_OVERLAY_SOURCE_ID);
            if (!src || typeof src.setData !== 'function') {
                return;
            }
            if (!geometry) {
                src.setData({ type: 'FeatureCollection', features: [] });
                syncRiyadhTileSelectionSuppressionForDraftClosure();
                return;
            }
            src.setData({
                type: 'FeatureCollection',
                features: [{ type: 'Feature', geometry: geometry, properties: {} }],
            });
        } catch (e) {
            // Non-critical
        }
    }

    function getBestAvailableSelectedGeometry() {
        const external = window.selectedRiyadhRoad || window.approvedLineBeingEdited || null;
        if (external && external.geometry) {
            return external.geometry;
        }
        return null;
    }

    function getCurrentExternalEditingFeature() {
        return window.selectedRiyadhRoad || window.approvedLineBeingEdited || null;
    }

    function normalizeFeatureLabel(label) {
        if (!label) {
            return 'line';
        }
        return label.toString().toLowerCase().trim();
    }

    function setSymbologyCatalog(catalog) {
        if (!catalog || !catalog.styles_by_label) {
            return;
        }

        symbologyCatalog = catalog;
        symbologyStylesByLabel = {};

        Object.keys(catalog.styles_by_label).forEach(function (rawLabel) {
            const normalizedKey = normalizeFeatureLabel(rawLabel);
            if (!normalizedKey) {
                return;
            }
            symbologyStylesByLabel[normalizedKey] = catalog.styles_by_label[rawLabel];
        });

        // Expose catalog so other scripts (e.g. manager-requests) can reuse it.
        window.symbologyCatalog = catalog;

        try {
            window.dispatchEvent(new CustomEvent('symbology:catalogLoaded', { detail: catalog }));
        } catch (e) {}

    }

    function ensureSymbologyCatalogRequested() {
        if (symbologyCatalog && symbologyStylesByLabel) {
            return;
        }
        if (window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
            setSymbologyCatalog(window.symbologyCatalog);
            return;
        }
        if (symbologyCatalogRequested) {
            return;
        }

        symbologyCatalogRequested = true;

        fetch('/symbology/api/catalog/', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Failed to load symbology catalog');
                }
                return response.json();
            })
            .then(function (data) {
                setSymbologyCatalog(data);
            })
            .catch(function () {
                symbologyCatalogRequested = false;
            });
    }

    function getVisualizationStyle(featureLabel) {
        ensureSymbologyCatalogRequested();
        const normalizedLabel = normalizeFeatureLabel(featureLabel || "Line");
        if (!symbologyStylesByLabel) {
            return undefined;
        }
        return symbologyStylesByLabel[normalizedLabel] || symbologyStylesByLabel["line"];
    }

    function isRoadClosedForCurrentContext() {
        try {
            if (typeof window.getCurrentRoadClosure === 'function') {
                return !!window.getCurrentRoadClosure();
            }
        } catch (e) {}
        const data = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
        return !!data && parseRoadClosurePayloadValue(data.road_closure);
    }

    function getEffectiveVisualizationStyle(featureLabel) {
        if (isRoadClosedForCurrentContext()) {
            return getVisualizationStyle('Road Closure');
        }
        return getVisualizationStyle(featureLabel);
    }

    function bringSelectedOverlayLayersToFront() {
        if (typeof map === 'undefined' || !map || !map.getLayer) {
            return;
        }
        const ids = [
            SELECTED_OVERLAY_OUTLINE_LAYER_ID,
            SELECTED_OVERLAY_RING_LAYER_ID,
            SELECTED_OVERLAY_GRADIENT_LAYER_ID,
            SELECTED_OVERLAY_LINE_LAYER_ID
        ];
        ids.forEach(function (id) {
            if (map.getLayer(id)) {
                try {
                    map.moveLayer(id);
                } catch (eMove) {}
            }
        });
    }

    function isDraftRoadClosureChangeActive() {
        const initial =
            typeof window.initialRoadClosureState === 'boolean'
                ? window.initialRoadClosureState
                : null;
        const current =
            typeof window.currentRoadClosureState === 'boolean'
                ? window.currentRoadClosureState
                : null;
        return initial !== null && current !== null ? initial !== current : !!current;
    }

    function hideSelectedOverlayPaint() {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        try {
            if (map.getLayer(SELECTED_OVERLAY_GRADIENT_LAYER_ID)) {
                map.setPaintProperty(SELECTED_OVERLAY_GRADIENT_LAYER_ID, 'line-opacity', 0);
            }
            if (map.getLayer(SELECTED_OVERLAY_OUTLINE_LAYER_ID)) {
                map.setPaintProperty(SELECTED_OVERLAY_OUTLINE_LAYER_ID, 'line-opacity', 0);
            }
            if (map.getLayer(SELECTED_OVERLAY_RING_LAYER_ID)) {
                map.setPaintProperty(SELECTED_OVERLAY_RING_LAYER_ID, 'line-opacity', 0);
            }
            if (map.getLayer(SELECTED_OVERLAY_LINE_LAYER_ID)) {
                map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-opacity', 0);
            }
        } catch (eHide) {}
    }

    function syncRiyadhTileSelectionSuppressionForDraftClosure() {
        if (typeof window.setRiyadhTileSelectionSuppressedForOverlay !== 'function') {
            return;
        }
        const ext = window.approvedLineBeingEdited || window.selectedRiyadhRoad || null;
        const closureStyleReady = !!getVisualizationStyle('Road Closure');
        const isDraftChange = isDraftRoadClosureChangeActive();
        const suppress =
            isDraftChange &&
            !!(ext && ext.is_riyadh_road && ext.geometry) &&
            closureStyleReady;
        try {
            window.setRiyadhTileSelectionSuppressedForOverlay(suppress);
        } catch (e) {}
        try {
            if (typeof window.setRiyadhRoadBasemapHiddenForClosureOverlay === 'function') {
                const rid = ext && (ext.riyadh_road_id != null ? ext.riyadh_road_id : ext.id);
                if (suppress && rid != null) {
                    window.setRiyadhRoadBasemapHiddenForClosureOverlay(rid, true);
                } else {
                    window.setRiyadhRoadBasemapHiddenForClosureOverlay(null, false);
                }
            }
        } catch (eBase) {}
    }

    function parseRoadClosurePayloadValue(raw) {
        return raw === 1 || raw === true || raw === '1' || (typeof raw === 'string' && String(raw).trim() === '1');
    }

    function applyRoadClosureDraftAndInitialFromRaw(raw) {
        if (raw === undefined || raw === null) {
            return;
        }
        const closed = parseRoadClosurePayloadValue(raw);
        window.currentRoadClosureState = closed;
        window.initialRoadClosureState = closed;
    }

    function patchRoadClosureOnSelectionContext(closed) {
        const v = closed ? 1 : 0;
        function mergeSnap(snap) {
            const fd = Object.assign({}, snap.fields_data || {}, { road_closure: v });
            return Object.assign({}, snap, { road_closure: v, fields_data: fd });
        }
        if (window.approvedLineBeingEdited) {
            window.approvedLineBeingEdited = mergeSnap(window.approvedLineBeingEdited);
        }
        if (window.selectedRiyadhRoad) {
            window.selectedRiyadhRoad = mergeSnap(window.selectedRiyadhRoad);
        }
    }

    function syncRoadClosureStateAfterPersist(roadClosureRaw) {
        const closed = parseRoadClosurePayloadValue(roadClosureRaw);
        window.currentRoadClosureState = closed;
        window.initialRoadClosureState = closed;
        patchRoadClosureOnSelectionContext(closed);
        if (typeof window.__paintRoadClosureToggle === 'function') {
            try {
                window.__paintRoadClosureToggle();
            } catch (eSync) {}
        }
        refreshSymbologyAfterRoadClosureChange();
    }

    function refreshSymbologyAfterRoadClosureChange() {
        const lbl = getCurrentFeatureLabel();
        let updated = false;

        if (currentLineId) {
            try {
                renderLineAsMapLibreLayer(currentLineId);
                updateLineVisualization();
                updated = true;
            } catch (e) {}
        }

        const ext = window.approvedLineBeingEdited || window.selectedRiyadhRoad || null;
        if (ext && ext.is_riyadh_road && ext.geometry) {
            try {
                const rid = ext.riyadh_road_id != null ? ext.riyadh_road_id : ext.id;
                if (rid != null) {
                    setSelectedOverlayGeometry(ext.geometry);
                    updateRiyadhRoadVisualization(rid, lbl, ext.geometry);
                    updateLineVisualizationFromGeometry(ext.geometry, lbl);
                    updated = true;
                }
            } catch (e2) {}
        }

        if (updated) {
            try {
                updateFeatureTypeVisualization();
            } catch (e3) {}
        }
        syncRiyadhTileSelectionSuppressionForDraftClosure();
    }

    function dasharrayToSvg(style) {
        const lineDasharray = getStyleDashArray(style);
        if (!lineDasharray) {
            return null;
        }
        return lineDasharray.map(function(x) { return String(x); }).join(',');
    }

    function getStyleDashArray(style) {
        if (!style || !style.lineDasharray || !Array.isArray(style.lineDasharray)) {
            return null;
        }
        return style.lineDasharray;
    }

    function getEffectiveDashArray(style) {
        return getStyleDashArray(style) || [1, 0];
    }

    function hasDashGap(lineDasharray) {
        return !!(
            Array.isArray(lineDasharray) &&
            lineDasharray.length >= 2 &&
            Number(lineDasharray[1]) > 0
        );
    }

    function getCasingOptionsForDash(lineDasharray) {
        return hasDashGap(lineDasharray) ? { dashOnlyOnCore: true } : undefined;
    }

    /** SVG previews: stack outline → ring → core to match map selection (no blur glow). */
    function appendSvgLinePathsWithMapSelectionCasing(svg, pathData, style, svgDasharray, strokeScale) {
        const mls = mapLineSelection();
        const oColor = (mls && mls.OUTLINE_COLOR) || '#0f172a';
        const rColor = (mls && mls.RING_COLOR) || '#ffffff';
        const oAdd = (mls && mls.OUTLINE_WIDTH_ADD != null) ? mls.OUTLINE_WIDTH_ADD : 7;
        const rAdd = (mls && mls.RING_WIDTH_ADD != null) ? mls.RING_WIDTH_ADD : 4;
        const oOp = (mls && mls.OUTLINE_OPACITY != null) ? mls.OUTLINE_OPACITY : 0.93;
        const rOp = (mls && mls.RING_OPACITY != null) ? mls.RING_OPACITY : 1;
        const sc = Number(strokeScale) > 0 ? Number(strokeScale) : 0.42;
        const lw = Number(style.lineWidth) || 4;
        const coreW = lw * sc;
        const ringW = coreW + rAdd * sc;
        const outlineW = coreW + oAdd * sc;

        function addPath(strokeW, color, opacity) {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', pathData);
            p.setAttribute('fill', 'none');
            p.setAttribute('stroke', color);
            p.setAttribute('stroke-width', String(strokeW));
            p.setAttribute('stroke-opacity', String(opacity));
            p.setAttribute('stroke-linecap', 'round');
            p.setAttribute('stroke-linejoin', 'round');
            if (svgDasharray) {
                p.setAttribute('stroke-dasharray', svgDasharray);
            }
            svg.appendChild(p);
        }

        addPath(outlineW, oColor, oOp);
        addPath(ringW, rColor, rOp);
        addPath(coreW, style.lineColor || '#52525b', 1);
    }

    function renderPreviewPlaceholder(container, message) {
        if (!container) {
            return;
        }
        const text = message || 'Loading style…';
        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'w-full h-full flex items-center justify-center text-xs text-zinc-500';
        wrapper.textContent = text;
        container.appendChild(wrapper);
    }

    function rerenderOnCatalogLoaded(rerenderFn) {
        if (!rerenderFn) {
            return;
        }
        window.addEventListener('symbology:catalogLoaded', rerenderFn, { once: true });
    }

    function normalizeToLineStringGeometry(input) {
        // Delegate to the centralized geometry normalizer.
        if (window.GeometryNormalize && window.GeometryNormalize.normalizeToLineStringGeometry) {
            return window.GeometryNormalize.normalizeToLineStringGeometry(input);
        }
        return null;
    }

    function initLineDrawing() {
        let drawControl = null;
        if (typeof draw !== 'undefined' && draw) {
            drawControl = draw;
        } else if (typeof window.draw !== 'undefined' && window.draw) {
            drawControl = window.draw;
        }

        if (!drawControl) {
            setTimeout(function() { initLineDrawing(); }, 100);
            return;
        }

        try {
            // Trigger symbology catalog fetch as early as possible
            ensureSymbologyCatalogRequested();

            if (typeof drawControl.getTerraDrawInstance === 'function') {
                drawInstance = drawControl.getTerraDrawInstance();
            } else if (typeof drawInstance !== 'undefined' && drawInstance) {
                drawInstance = window.drawInstance;
            }
            
            if (!drawInstance) {
                setTimeout(function() { initLineDrawing(); }, 100);
                return;
            }

            if (typeof window.currentRoadClosureState === 'undefined') {
                window.currentRoadClosureState = false;
            }
            if (typeof window.initialRoadClosureState === 'undefined') {
                window.initialRoadClosureState = false;
            }
            window.getCurrentRoadClosure = function () {
                return !!window.currentRoadClosureState;
            };
            window.setCurrentRoadClosure = function (value, options) {
                options = options || {};
                window.currentRoadClosureState = !!value;
                if (options.syncInitial !== false) {
                    window.initialRoadClosureState = window.currentRoadClosureState;
                }
                if (!options.skipPaint && typeof window.__paintRoadClosureToggle === 'function') {
                    try {
                        window.__paintRoadClosureToggle();
                    } catch (eRc) {}
                }
            };

            sidePanel = document.getElementById('editSidePanel');
            sidePanelContent = document.getElementById('sidePanelContent');

            initMapSidePanelChrome();

            setupLineDrawingListeners();
            setupFeatureSearch();
            startHidingDefaultRendering();

            try {
                if (!window.__naqelSymbologyClosureListener) {
                    window.__naqelSymbologyClosureListener = true;
                    window.addEventListener('symbology:catalogLoaded', function () {
                        if (window.currentRoadClosureState) {
                            refreshSymbologyAfterRoadClosureChange();
                        }
                    });
                }
            } catch (eSym) {}
            
            // Ensure TerraDraw is in select mode for viewing features (works even when edit mode is disabled)
            // This allows users to click on drawn lines to view them in the sidebar
            try {
                const currentMode = drawInstance.getMode();
                // If no mode is set or it's not select, set it to select mode
                // This enables clicking on features to view them
                if (!currentMode || (currentMode !== 'select' && currentMode !== 'render')) {
                    drawInstance.setMode('select');
                }
            } catch (e) {
                // Could not set mode, continue anyway
            }
        } catch (error) {
            setTimeout(function() { initLineDrawing(); }, 200);
        }
    }

    function setupLineDrawingListeners() {
        if (!drawInstance) return;

        drawInstance.on('finish', function(id) {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });
            if (feature && feature.geometry && feature.geometry.type === 'LineString') {
                stopDrawingMonitor();
                handleLineDrawn(id);
            }
        });
        
        setInterval(function() {
            if (!drawInstance) return;
            
            try {
                const currentMode = drawInstance.getMode();
                if (currentMode === 'linestring') {
                    const snapshot = drawInstance.getSnapshot();
                    const lineFeatures = snapshot.filter(function(f) {
                        return f.geometry && f.geometry.type === 'LineString';
                    });
                    
                    if (lineFeatures.length > 0) {
                        const latestLine = lineFeatures[lineFeatures.length - 1];
                        const lineId = latestLine.id;
                        
                        if (drawingLineId !== lineId) {
                            drawingLineId = lineId;
                            currentLineId = lineId;
                            startDrawingMonitor();
                        }
                    }
                } else {
                    stopDrawingMonitor();
                }
            } catch (e) {
                // Error monitoring drawing
            }
        }, 100);

        drawInstance.on('select', function(id) {
            handleFeatureSelected(id);
        });

        drawInstance.on('deselect', function() {
            handleFeatureDeselected();
        });
    }
    
    function hideDefaultRendering() {
        if (typeof map === 'undefined' || !map) return;
        
        try {
            const mapContainer = map.getContainer();
            if (!mapContainer) return;
            
            const svgOverlays = mapContainer.querySelectorAll('svg');
            svgOverlays.forEach(function(svg) {
                const paths = svg.querySelectorAll('path');
                paths.forEach(function(path) {
                    const pathData = path.getAttribute('d') || '';
                    if (pathData && (pathData.includes('L') || pathData.includes('M') || pathData.includes('l') || pathData.includes('m') || pathData.includes('Z') || pathData.includes('z'))) {
                        path.style.setProperty('display', 'none', 'important');
                        path.style.setProperty('visibility', 'hidden', 'important');
                        path.style.setProperty('opacity', '0', 'important');
                        path.setAttribute('display', 'none');
                    }
                });
                
                const lines = svg.querySelectorAll('line');
                lines.forEach(function(line) {
                    line.style.setProperty('display', 'none', 'important');
                    line.style.setProperty('visibility', 'hidden', 'important');
                    line.style.setProperty('opacity', '0', 'important');
                    line.setAttribute('display', 'none');
                });
            });
        } catch (e) {
            // Could not hide default rendering
        }
    }
    
    function setupSVGObserver() {
        if (typeof map === 'undefined' || !map) return;
        
        try {
            const mapContainer = map.getContainer();
            if (!mapContainer) return;
            
            if (svgObserver) {
                svgObserver.disconnect();
            }
            
            svgObserver = new MutationObserver(function(mutations) {
                hideDefaultRendering();
            });
            
            svgObserver.observe(mapContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['d', 'x1', 'y1', 'x2', 'y2', 'class']
            });
        } catch (e) {
            // Could not setup SVG observer
        }
    }
    
    function startHidingDefaultRendering() {
        if (typeof map === 'undefined' || !map) return;
        
        hideDefaultRendering();
        setupSVGObserver();
        
        map.on('render', function() {
            hideDefaultRendering();
        });
        
        setInterval(function() {
            hideDefaultRendering();
        }, 50);
    }
    
    function startDrawingMonitor() {
        if (drawingMonitorInterval) {
            clearInterval(drawingMonitorInterval);
        }
        
        drawingMonitorInterval = setInterval(function() {
            if (!drawInstance || !drawingLineId) {
                if (drawingMonitorInterval) {
                    clearInterval(drawingMonitorInterval);
                    drawingMonitorInterval = null;
                }
                return;
            }
            
            try {
                const snapshot = drawInstance.getSnapshot();
                const feature = snapshot?.find(function(f) { return f.id === drawingLineId; });
                
                if (feature && feature.geometry && feature.geometry.type === 'LineString') {
                    const coords = feature.geometry.coordinates;
                    if (coords && coords.length >= 2) {
                        renderLineAsMapLibreLayer(drawingLineId);
                        hideDefaultRendering();
                    }
                } else {
                    if (drawingMonitorInterval) {
                        clearInterval(drawingMonitorInterval);
                        drawingMonitorInterval = null;
                    }
                    drawingLineId = null;
                }
                } catch (e) {
                    // Error in drawing monitor
                }
        }, 50);
    }
    
    function stopDrawingMonitor() {
        if (drawingMonitorInterval) {
            clearInterval(drawingMonitorInterval);
            drawingMonitorInterval = null;
        }
        drawingLineId = null;
    }

    function handleLineDrawn(id) {
        if (!drawInstance) return;

        try {
            stopDrawingMonitor();
            
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });

            if (feature && feature.geometry && feature.geometry.type === 'LineString') {
                currentLineId = id;
                selectedLineId = id;
                
                hideDefaultRendering();
                renderLineAsMapLibreLayer(id);
                
                setTimeout(function() {
                    if (drawInstance) {
                        try {
                            drawInstance.setMode('select');
                        } catch (e) {
                            // Could not set select mode
                        }
                    }
                    
                    hideDefaultRendering();
                    showLineSidePanel();
                    updateCurrentFeatureLabel('Line');
                    clearVertexMarkers();
                    setMapContainerDrawnLineSelectionAttr(id);
                    updateLineVisualization();

                    if (typeof window.setCurrentRoadClosure === 'function') {
                        window.setCurrentRoadClosure(false);
                    }
                    
                    setTimeout(function() {
                        hideDefaultRendering();
                    }, 50);
                }, 100);
            }
        } catch (error) {
            // Error handling line drawn
        }
    }

    function selectLine(id) {
        if (!drawInstance) {
            setTimeout(function() { selectLine(id); }, 100);
            return;
        }

        try {
            selectedLineId = id;
            currentLineId = id;
            
            if (!currentFeatureLabel) {
                updateCurrentFeatureLabel('Line');
            }

            const currentMode = drawInstance.getMode();
            if (currentMode !== 'select') {
                drawInstance.setMode('select');
            }

            hideDefaultRendering();
            setMapContainerDrawnLineSelectionAttr(id);

            setTimeout(function() {
                hideDefaultRendering();
                renderLineAsMapLibreLayer(id);
                clearVertexMarkers();
            }, 100);
        } catch (error) {
            selectedLineId = id;
            currentLineId = id;
            
            if (!currentFeatureLabel) {
                updateCurrentFeatureLabel('Line');
            }
            
            setMapContainerDrawnLineSelectionAttr(id);
            clearVertexMarkers();
        }
    }

    function setMapContainerDrawnLineSelectionAttr(id) {
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.setAttribute('data-selected-line', id);
        }
        hideDefaultRendering();
    }

    function selectDrawnLineForViewing(id) {
        // Single-path selection handler for TerraDraw LineString features:
        // - updates selection state
        // - ensures select mode
        // - applies MapLibre rendering + selection casing
        // - opens side panel and renders preview
        if (!drawInstance || !id) {
            return;
        }

        const hadRiyadhContext =
            !!(window.selectedRiyadhRoad ||
                (window.approvedLineBeingEdited && window.approvedLineBeingEdited.is_riyadh_road));

        try {
            window.selectedRiyadhRoad = null;
            window.approvedLineBeingEdited = null;
            if (typeof window.setRiyadhRoadSelectedId === 'function') {
                window.setRiyadhRoadSelectedId(null);
            }
            setSelectedOverlayGeometry(null);
            syncRiyadhTileSelectionSuppressionForDraftClosure();
        } catch (eClear) {}

        if (hadRiyadhContext && typeof window.setCurrentRoadClosure === 'function') {
            window.setCurrentRoadClosure(false);
        }

        selectedLineId = id;
        currentLineId = id;

        // Update selection tracking
        window.currentlySelectedItem = id;
        window.currentlySelectedItemType = 'terradraw-line';

        try {
            const currentMode = drawInstance.getMode();
            if (currentMode !== 'select') {
                drawInstance.setMode('select');
            }
        } catch (e) {
            // Non-critical
        }

        if (!currentFeatureLabel) {
            updateCurrentFeatureLabel('Line');
        }

        hideDefaultRendering();
        renderLineAsMapLibreLayer(id);
        setMapContainerDrawnLineSelectionAttr(id);
        clearVertexMarkers();

        // Open the side panel with a consistent rendering path.
        showLineSidePanel();

        // Ensure the default feature label is visible for new drawn lines.
        updateCurrentFeatureLabel('Line');

        // Defensive: allow MapLibre style updates to settle.
        setTimeout(function() {
            hideDefaultRendering();
        }, 50);
    }

    function handleFeatureSelected(id) {
        if (!drawInstance) {
            return;
        }

        try {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });

            if (feature && feature.geometry) {
                if (feature.geometry.type === 'LineString') {
                    selectDrawnLineForViewing(id);
                } else {
                    hideLineSidePanel();
                }
            }
        } catch (error) {
            // Error handling feature selection
        }
    }

    function handleFeatureDeselected() {
        if (selectedLineId) {
            removeMapLibreLineLayer(selectedLineId);
        }
        
        selectedLineId = null;
        currentLineId = null;
        clearVertexMarkers();
        
        // Clear selection tracking
        if (window.currentlySelectedItemType === 'terradraw-line') {
            window.currentlySelectedItem = null;
            window.currentlySelectedItemType = null;
        }
        
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.removeAttribute('data-selected-line');
        }
            
        if (typeof map !== 'undefined' && map) {
            if (map._lineMarkerUpdater) {
                map.off('move', map._lineMarkerUpdater);
                map.off('zoom', map._lineMarkerUpdater);
                map._lineMarkerUpdater = null;
            }
        }

        // If nothing external is selected, clear the selection overlay.
        try {
            if (!window.selectedRiyadhRoad && !window.approvedLineBeingEdited) {
                setSelectedOverlayGeometry(null);
            }
        } catch (e) {}
    }

    function showLineSidePanel() {
        if (typeof window.roadGeometryEdit !== 'undefined' && window.roadGeometryEdit.stop) {
            window.roadGeometryEdit.stop();
        }

        initMapSidePanelChrome();
        applyMapSidePanelOpen(true);

        const sidePanel = document.getElementById('editSidePanel');
        if (sidePanel) {
            sidePanel.style.display = '';
            sidePanel.style.visibility = 'visible';
            sidePanel.style.opacity = '1';
        }
        
        if (!sidePanelContent) {
            setTimeout(showLineSidePanel, 100);
            return;
        }

        const editScreen = document.getElementById('editFeatureScreen');
        if (editScreen) {
            editScreen.remove();
        }

        showSidePanelDefaultElements();

        const searchResults = document.getElementById('featureSearchResults');
        if (searchResults) {
            searchResults.style.display = 'block';
            searchResults.innerHTML = '<p class="text-xs text-zinc-500 px-1 py-4 leading-relaxed">Type to search feature types (e.g. Motorway, Path, Fence)</p>';
        }
        const linePanelContent = document.getElementById('linePanelContent');
        const linePanel = linePanelContent || sidePanelContent;
        if (linePanelContent) {
            linePanelContent.style.display = 'block';
        }

        const contentArea = document.getElementById('sidePanelScrollArea') || document.querySelector('#editSidePanel .flex-1.overflow-y-auto');
        if (contentArea) {
            contentArea.style.display = 'block';
        }

        function ensureLinePanelStructure() {
            let dropdownsContainer = document.getElementById('lineDropdownsContainer');
            const visualizationContainer = document.getElementById('lineVisualizationContainer');

            if (!dropdownsContainer) {
                linePanel.innerHTML = '';
            }

            if (!visualizationContainer) {
                const viz = createLineVisualization();
                if (viz) {
                    linePanel.appendChild(viz);
                }
            }

            if (!dropdownsContainer) {
                dropdownsContainer = document.createElement('div');
                dropdownsContainer.className = 'space-y-3';
                dropdownsContainer.id = 'lineDropdownsContainer';

                const dropdownLabels = [
                    'Major Roads...',
                    'Minor Roads...',
                    'Rails...',
                    'Paths...',
                    'Waterways...',
                    'Barrier Features...',
                    'Natural Features...',
                    'Utility Features...'
                ];

                dropdownLabels.forEach(function(label) {
                    const dropdownBox = createDropdownBox(label, false);
                    dropdownsContainer.appendChild(dropdownBox);
                });

                const lineBox = createLineBox();
                dropdownsContainer.appendChild(lineBox);

                linePanel.appendChild(dropdownsContainer);
                populateDropdowns();
            } else {
                dropdownsContainer.style.display = 'block';
            }

            return dropdownsContainer;
        }

        function renderCurrentFeaturePreview() {
            const featureLabel = getCurrentFeatureLabel();
            const geometry =
                window.approvedLineBeingEdited && window.approvedLineBeingEdited.geometry
                    ? window.approvedLineBeingEdited.geometry
                    : null;

            if (geometry) {
                updateLineVisualizationFromGeometry(geometry, featureLabel);
                return;
            }

            // Drawn line preview (TerraDraw) — will no-op if no line is selected.
            updateLineVisualization();

            // If nothing is selected, show a placeholder instead of an empty card.
            if (!currentLineId) {
                const svgContainer = document.getElementById('lineVisualizationSVG');
                if (svgContainer) {
                    renderPreviewPlaceholder(svgContainer, 'Select a line to preview');
                }
            }
        }

        ensureLinePanelStructure();
        renderCurrentFeaturePreview();
    }

    function createLineVisualization() {
        const container = document.createElement('div');
        container.id = 'lineVisualizationContainer';
        container.className =
            'map-line-symbology-preview mb-4 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm';
        container.style.display = 'block'; // Ensure container is visible

        const labelText = document.createElement('div');
        labelText.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1.5';
        labelText.textContent = 'Current feature';
        container.appendChild(labelText);

        const valueDisplay = document.createElement('div');
        valueDisplay.id = 'lineVisualizationFeatureName';
        valueDisplay.className = 'text-sm font-semibold text-zinc-900 mb-2';
        // Use current feature label instead of hardcoding 'Line'
        valueDisplay.textContent = currentFeatureLabel || 'Line';
        container.appendChild(valueDisplay);

        const svgContainer = document.createElement('div');
        svgContainer.id = 'lineVisualizationSVG';
        svgContainer.className =
            'relative w-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50';
        svgContainer.style.height = '140px';
        svgContainer.style.width = '100%';
        svgContainer.style.minHeight = '140px';
        svgContainer.style.display = 'block';
        svgContainer.style.visibility = 'visible';
        svgContainer.style.opacity = '1';
        container.appendChild(svgContainer);

        return container;
    }

    // Update line visualization from provided geometry (for approved lines).
    function updateLineVisualizationFromGeometry(geometry, featureLabel) {
        const svgContainer = document.getElementById('lineVisualizationSVG');
        if (!svgContainer) {
            return;
        }
        
        const normalizedGeometry = normalizeToLineStringGeometry(geometry);
        if (!normalizedGeometry) {
            renderPreviewPlaceholder(svgContainer, 'No preview available');
            return;
        }

        try {
            const coordinates = normalizedGeometry.coordinates;
            if (!coordinates || coordinates.length < 2) {
                renderPreviewPlaceholder(svgContainer, 'No preview available');
                return;
            }

            // Ensure container has dimensions - if not, wait a bit and retry
            let width = svgContainer.offsetWidth;
            let height = svgContainer.offsetHeight;
            
            if (!width || !height || width === 0 || height === 0) {
                // Container might not be visible yet, use default dimensions
                width = 300;
                height = 200;
                // Force dimensions if container exists but has no size
                if (svgContainer.parentElement) {
                    svgContainer.style.width = '100%';
                    svgContainer.style.height = '200px';
                    width = svgContainer.offsetWidth || 300;
                    height = svgContainer.offsetHeight || 200;
                }
            }
            const padding = 20;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coordinates.forEach(function(coord) {
                minX = Math.min(minX, coord[0]);
                minY = Math.min(minY, coord[1]);
                maxX = Math.max(maxX, coord[0]);
                maxY = Math.max(maxY, coord[1]);
            });

            const rangeX = maxX - minX || 0.001;
            const rangeY = maxY - minY || 0.001;
            const scaleX = (width - padding * 2) / rangeX;
            const scaleY = (height - padding * 2) / rangeY;
            const scale = Math.min(scaleX, scaleY);

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const offsetX = width / 2 - centerX * scale;
            const offsetY = height / 2 + centerY * scale;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width.toString());
            svg.setAttribute('height', height.toString());
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.style.display = 'block';

            // Use same coordinate transformation as updateLineVisualization
            let pathData = 'M ';
            coordinates.forEach(function(coord, index) {
                const x = coord[0] * scale + offsetX;
                const y = -coord[1] * scale + offsetY;
                if (index === 0) {
                    pathData += x.toFixed(2) + ' ' + y.toFixed(2);
                } else {
                    pathData += ' L ' + x.toFixed(2) + ' ' + y.toFixed(2);
                }
            });

            const labelToUse = featureLabel || getCurrentFeatureLabel();
            const style = getEffectiveVisualizationStyle(labelToUse);
            if (!style) {
                renderPreviewPlaceholder(svgContainer, 'Loading symbology…');
                rerenderOnCatalogLoaded(function() {
                    updateLineVisualizationFromGeometry(geometry, featureLabel);
                });
                return;
            }
            const svgDasharray = dasharrayToSvg(style);
            const previewStroke = 0.42;
            appendSvgLinePathsWithMapSelectionCasing(svg, pathData, style, svgDasharray, previewStroke);

            svgContainer.innerHTML = '';
            svgContainer.appendChild(svg);
        } catch (error) {
            // Error updating visualization
        }
    }

    function updateLineVisualization() {
        if (!drawInstance || !currentLineId) return;

        const svgContainer = document.getElementById('lineVisualizationSVG');
        if (!svgContainer) return;

        try {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === currentLineId; });

            if (!feature || !feature.geometry || feature.geometry.type !== 'LineString') {
                return;
            }

            const coordinates = feature.geometry.coordinates;
            if (!coordinates || coordinates.length < 2) {
                svgContainer.innerHTML = '';
                return;
            }

            const width = svgContainer.offsetWidth || 300;
            const height = svgContainer.offsetHeight || 200;
            const padding = 20;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coordinates.forEach(function(coord) {
                minX = Math.min(minX, coord[0]);
                minY = Math.min(minY, coord[1]);
                maxX = Math.max(maxX, coord[0]);
                maxY = Math.max(maxY, coord[1]);
            });

            const rangeX = maxX - minX || 0.001;
            const rangeY = maxY - minY || 0.001;
            const scaleX = (width - padding * 2) / rangeX;
            const scaleY = (height - padding * 2) / rangeY;
            const scale = Math.min(scaleX, scaleY);

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const offsetX = width / 2 - centerX * scale;
            const offsetY = height / 2 + centerY * scale;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width.toString());
            svg.setAttribute('height', height.toString());
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.style.display = 'block';

            let pathData = 'M ';
            coordinates.forEach(function(coord, index) {
                const x = coord[0] * scale + offsetX;
                const y = -coord[1] * scale + offsetY;
                if (index === 0) {
                    pathData += x + ' ' + y;
                } else {
                    pathData += ' L ' + x + ' ' + y;
                }
            });

            const style = getEffectiveVisualizationStyle(currentFeatureLabel);
            if (!style) {
                renderPreviewPlaceholder(svgContainer, 'Loading symbology…');
                rerenderOnCatalogLoaded(function() {
                    updateLineVisualization();
                });
                return;
            }
            const svgDasharray = dasharrayToSvg(style);
            appendSvgLinePathsWithMapSelectionCasing(svg, pathData, style, svgDasharray, 1);

            svgContainer.innerHTML = '';
            svgContainer.appendChild(svg);

        } catch (e) {
            // Error updating line visualization
        }
    }

    // Set current feature type and update map symbology immediately.
    // Map display updates without Save; persistence and approval happen on Save.
    function updateCurrentFeatureLabel(featureType) {
        featureType = featureType || "Line";
        currentFeatureLabel = featureType;

        const valueDisplay = document.getElementById("currentFeatureValue");
        if (valueDisplay) valueDisplay.textContent = currentFeatureLabel;

        const visualizationFeatureName = document.getElementById("lineVisualizationFeatureName");
        if (visualizationFeatureName) visualizationFeatureName.textContent = currentFeatureLabel;

        const selectedFeatureName = document.getElementById("selectedFeatureName");
        if (selectedFeatureName) selectedFeatureName.textContent = currentFeatureLabel;

        if (currentLineId) {
            renderLineAsMapLibreLayer(currentLineId);
            clearVertexMarkers();
        }

        // Always keep the sidepanel previews in sync, regardless of whether
        // the user is editing a drawn line, an approved line, or a tile road.
        const external = getCurrentExternalEditingFeature();
        try {
            if (external && external.geometry) {
                updateLineVisualizationFromGeometry(external.geometry, currentFeatureLabel);
            } else {
                updateLineVisualization();
            }
        } catch (e) {
            // Non-critical
        }

        // Update map symbology for approved lines / tile roads being edited.
        try {
            if (external && external.is_riyadh_road) {
                if (!external._original_feature_label) {
                    external._original_feature_label = external.current_feature_label || external.feature_type || currentFeatureLabel;
                }
                external.current_feature_label = currentFeatureLabel;
                external.feature_type = currentFeatureLabel;
                const roadId = external.riyadh_road_id != null ? external.riyadh_road_id : external.id;
                if (roadId != null && external.geometry) {
                    updateRiyadhRoadVisualization(roadId, currentFeatureLabel, external.geometry);
                    setSelectedOverlayGeometry(external.geometry);
                }
            }
        } catch (e) {
            // Non-critical
        }

        updateFeatureTypeVisualization();

        // Ensure all Feature Type label displays (selector + header) stay in sync.
        if (typeof updateFeatureTypeLabelDisplay === 'function') {
            try {
                updateFeatureTypeLabelDisplay();
            } catch (e) {
                // Non-critical UI sync failure.
            }
        }
    }

    function getCurrentFeatureLabel() {
        return currentFeatureLabel || 'Line';
    }

    function clearVertexMarkers() {
        vertexMarkers.forEach(function(marker) {
            try {
                marker.remove();
            } catch (e) {
                // Error removing marker
            }
        });
        vertexMarkers = [];
    }

    function renderLineAsMapLibreLayer(id) {
        if (typeof map === 'undefined' || !map || !drawInstance) return;
        
        try {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });
            
            if (!feature || !feature.geometry || feature.geometry.type !== 'LineString') {
                return;
            }
            
            const coords = feature.geometry.coordinates;
            if (!coords || coords.length < 2) {
                return;
            }

            const sourceId = 'drawn-line-' + id;
            const layerId = 'drawn-line-layer-' + id;
            const outlineLayerId = 'drawn-line-outline-' + id;
            const ringLayerId = 'drawn-line-ring-' + id;
            
            if (!map.loaded() || !map.isStyleLoaded()) {
                map.once('load', function() {
                    renderLineAsMapLibreLayer(id);
                });
                map.once('style.load', function() {
                    renderLineAsMapLibreLayer(id);
                });
                return;
            }
            
            const style = getEffectiveVisualizationStyle(currentFeatureLabel);
            if (!style) {
                rerenderOnCatalogLoaded(function () {
                    renderLineAsMapLibreLayer(id);
                });
                return;
            }
            if (!mapLineSelection()) {
                return;
            }
            const lineDasharray = getEffectiveDashArray(style);
            const casingOpts = getCasingOptionsForDash(lineDasharray);

            const existingSource = map.getSource(sourceId);
            const existingOutline = map.getLayer(outlineLayerId);
            const existingRing = map.getLayer(ringLayerId);
            const existingLayer = map.getLayer(layerId);
            
            if (existingSource && existingSource.setData && existingOutline && existingRing && existingLayer) {
                try {
                    existingSource.setData({
                        type: 'FeatureCollection',
                        features: [feature]
                    });

                    mapLineSelection().applyGeoJsonCasingFromCoreWidth(map, outlineLayerId, ringLayerId, style.lineWidth, lineDasharray, casingOpts);
                    
                    map.setPaintProperty(layerId, 'line-color', style.lineColor);
                    map.setPaintProperty(layerId, 'line-width', style.lineWidth);
                    map.setPaintProperty(layerId, 'line-dasharray', lineDasharray);
                    
                    hideDefaultRendering();
                    return;
                } catch (e) {
                    // Could not update source, recreating
                }
            }
            
            try {
                if (map.getLayer(layerId)) {
                    map.removeLayer(layerId);
                }
                if (map.getLayer(ringLayerId)) {
                    map.removeLayer(ringLayerId);
                }
                if (map.getLayer(outlineLayerId)) {
                    map.removeLayer(outlineLayerId);
                }
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch (e) {
                // Could not remove existing layers
            }
            
            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [feature]
                }
            });
            
            (function () {
                const pair = mapLineSelection().maplibreSelectionCasingPaintPair(style.lineWidth, lineDasharray, casingOpts);
                map.addLayer({
                    id: outlineLayerId,
                    type: 'line',
                    source: sourceId,
                    paint: pair.outline,
                });
                map.addLayer({
                    id: ringLayerId,
                    type: 'line',
                    source: sourceId,
                    paint: pair.ring,
                });
            })();
            
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': style.lineColor,
                    'line-width': style.lineWidth,
                    'line-opacity': 1,
                    'line-dasharray': lineDasharray
                }
            });
            
            if (!map._drawnLineLayers) {
                map._drawnLineLayers = {};
            }
            map._drawnLineLayers[id] = {
                sourceId: sourceId,
                layerId: layerId,
                outlineLayerId: outlineLayerId,
                ringLayerId: ringLayerId
            };
            
            hideDefaultRendering();
            
        } catch (e) {
            setTimeout(function() {
                renderLineAsMapLibreLayer(id);
            }, 100);
        }
    }

    function removeMapLibreLineLayer(id) {
        if (typeof map === 'undefined' || !map || !map._drawnLineLayers || !map._drawnLineLayers[id]) {
            return;
        }
        
        try {
            const layers = map._drawnLineLayers[id];
            
            if (map.getLayer(layers.layerId)) {
                map.removeLayer(layers.layerId);
            }
            if (layers.ringLayerId && map.getLayer(layers.ringLayerId)) {
                map.removeLayer(layers.ringLayerId);
            }
            if (layers.outlineLayerId && map.getLayer(layers.outlineLayerId)) {
                map.removeLayer(layers.outlineLayerId);
            }
            if (map.getSource(layers.sourceId)) {
                map.removeSource(layers.sourceId);
            }
            
            delete map._drawnLineLayers[id];
        } catch (e) {
            // Error removing MapLibre line layer
        }
    }

    function createDropdownBox(label, isLast) {
        const container = document.createElement('div');
        container.className = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3 text-left text-zinc-900 shadow-sm transition-colors duration-200 flex items-center justify-between group';
        button.setAttribute('data-dropdown-toggle', 'dropdown-' + label.replace(/\s+/g, '-').toLowerCase());

        const icon = createIconForLabel(label);
        
        const buttonContent = document.createElement('div');
        buttonContent.className = 'flex items-center gap-3 flex-1';
        buttonContent.appendChild(icon);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium flex-1';
        labelSpan.textContent = label;
        buttonContent.appendChild(labelSpan);

        const chevron = document.createElement('svg');
        chevron.className = 'w-4 h-4 text-zinc-400 group-hover:text-zinc-700 transition-colors';
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
        buttonContent.appendChild(chevron);

        button.appendChild(buttonContent);

        const dropdownMenu = document.createElement('div');
        dropdownMenu.id = 'dropdown-' + label.replace(/\s+/g, '-').toLowerCase();
        dropdownMenu.className = 'hidden absolute z-50 w-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-60 overflow-y-auto';
        dropdownMenu.setAttribute('role', 'menu');
        dropdownMenu.setAttribute('data-dropdown-label', label);

        button.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleDropdown(dropdownMenu);
        });

        document.addEventListener('click', function(e) {
            if (!container.contains(e.target)) {
                dropdownMenu.classList.add('hidden');
            }
        });

        container.appendChild(button);
        container.appendChild(dropdownMenu);

        return container;
    }

    function createLineBox() {
        const container = document.createElement('div');
        container.className = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3 text-left text-zinc-900 shadow-sm transition-colors duration-200 flex items-center justify-between group';
        button.setAttribute('data-line-box', 'true');

        const iconContainer = document.createElement('div');
        iconContainer.className = 'flex-shrink-0 w-6 h-6 flex items-center justify-center';

        const folderContainer = document.createElement('div');
        folderContainer.className = 'w-5 h-5 rounded flex items-center justify-center bg-zinc-200';

        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('class', 'w-4 h-4');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'none');
        iconSvg.setAttribute('stroke', '#71717a');
        iconSvg.setAttribute('stroke-width', '2');
        iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M6 8v8M12 8v8M18 8v8"></path>';
        folderContainer.appendChild(iconSvg);
        iconContainer.appendChild(folderContainer);

        const buttonContent = document.createElement('div');
        buttonContent.className = 'flex items-center gap-3 flex-1';
        buttonContent.appendChild(iconContainer);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium flex-1';
        labelSpan.textContent = 'Line';
        buttonContent.appendChild(labelSpan);

        const chevron = document.createElement('svg');
        chevron.className = 'w-4 h-4 text-zinc-400 group-hover:text-zinc-700 transition-colors';
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
        buttonContent.appendChild(chevron);

        button.appendChild(buttonContent);

        button.addEventListener('click', function(e) {
            e.stopPropagation();
            handleLineBoxClick();
        });

        container.appendChild(button);
        return container;
    }

    function handleLineBoxClick() {
        if (!currentLineId) return;

        currentFeatureLabel = 'Line';
        updateCurrentFeatureLabel('Line');
        selectLine(currentLineId);
        showEditFeatureScreen();
    }

    function updateDropdownButtonText(dropdownLabel, selectedValue) {
        const dropdownsContainer = document.getElementById('lineDropdownsContainer');
        if (!dropdownsContainer) return;

        const dropdowns = dropdownsContainer.querySelectorAll('[data-dropdown-toggle]');
        dropdowns.forEach(function(dropdownButton) {
            const menuId = dropdownButton.getAttribute('data-dropdown-toggle');
            const menu = document.getElementById(menuId);
            if (menu && menu.getAttribute('data-dropdown-label') === dropdownLabel) {
                const labelSpan = dropdownButton.querySelector('span');
                if (labelSpan) {
                    labelSpan.textContent = dropdownLabel;
                }
            }
        });
    }

    function showEditFeatureScreen(options) {
        options = options || {};
        const hideBackButton = options.hideBackButton || false;
        const requestGeometry = options.requestGeometry || null;
        const lineData = options.lineData || null;

        if (lineData != null && lineData.road_closure != null) {
            applyRoadClosureDraftAndInitialFromRaw(lineData.road_closure);
        }

        initMapSidePanelChrome();
        applyMapSidePanelOpen(true);

        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) return;

        sidePanel.style.display = '';

        const existingEditScreen = document.getElementById('editFeatureScreen');
        if (existingEditScreen) {
            existingEditScreen.remove();
        }

        if (!currentFeatureLabel) {
            currentFeatureLabel = 'Line';
        }

        hideSidePanelDefaultElements();

        const flexContainer = document.getElementById('sidePanelInner') || sidePanel.querySelector('.h-full.flex.flex-col');
        if (!flexContainer) return;

        const editScreen = document.createElement('div');
        editScreen.id = 'editFeatureScreen';
        editScreen.className = 'h-full flex flex-col bg-zinc-50 text-zinc-900 min-h-0';

        if (hideBackButton) {
            editScreen.setAttribute('data-geometry-readonly', 'true');
        } else {
            editScreen.removeAttribute('data-geometry-readonly');
        }
        
        // Store request geometry for visualization
        if (requestGeometry) {
            editScreen.setAttribute('data-request-geometry', JSON.stringify(requestGeometry));
        }
        
        // Store line data if provided
        if (lineData) {
            editScreen.setAttribute('data-line-data', JSON.stringify(lineData));
        }
        
        const header = document.createElement('div');
        header.className = 'px-4 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0';

        const backButton = document.createElement('button');
        backButton.className = 'p-2 hover:bg-zinc-100 rounded-lg transition-colors flex-shrink-0';
        backButton.innerHTML = '<svg class="w-5 h-5 text-zinc-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>';
        
        // Hide back button if viewing a request.
        if (hideBackButton) {
            backButton.style.display = 'none';
        } else {
            backButton.addEventListener('click', function() {
                showLineSidePanel();
            });
        }

        const title = document.createElement('h2');
        title.className = 'text-base font-semibold text-zinc-900 flex-1 text-center';
        title.textContent = 'Edit feature';

        // Resolve delete target from the explicit options first (works even before the edit screen DOM exists).
        const deleteTarget = getDeleteTargetFromEditScreenOptions({ lineData: lineData }) || getDeleteTargetFromContext();
        const deleteButton = document.createElement('button');
        deleteButton.className = 'p-2 hover:bg-zinc-100 rounded-lg transition-colors flex-shrink-0';
        deleteButton.setAttribute('aria-label', 'Request delete');
        deleteButton.innerHTML = '<svg class="w-5 h-5 text-zinc-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m3 0V4a1 1 0 011-1h6a1 1 0 011 1v3m-9 0h10"></path></svg>';
        if (!deleteTarget) {
            deleteButton.style.display = 'none';
        } else {
            deleteButton.addEventListener('click', function (e) {
                e.stopPropagation();
                requestDeleteForCurrentFeature();
            });
        }

        const closeButton = document.createElement('button');
        closeButton.className = 'p-2 hover:bg-zinc-100 rounded-lg transition-colors flex-shrink-0';
        closeButton.innerHTML = '<svg class="w-5 h-5 text-zinc-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
        
        // Disable close button if viewing a request
        if (hideBackButton) {
            closeButton.style.display = 'none';
        } else {
            closeButton.addEventListener('click', function() {
                showLineSidePanel();
            });
        }

        header.appendChild(backButton);
        header.appendChild(title);
        header.appendChild(deleteButton);
        header.appendChild(closeButton);
        editScreen.appendChild(header);

        const content = document.createElement('div');
        content.className = 'flex-1 overflow-y-auto min-h-0';

        const featureTypeItem = createFeatureTypeMenuItem();
        content.appendChild(featureTypeItem);

        const menuItems = [
            { label: 'Fields', id: 'fields' },
            { label: 'Tags (0)', id: 'tags' },
            { label: 'Relations (0)', id: 'relations' }
        ];

        menuItems.forEach(function(item) {
            if (item.id === 'fields') {
                const menuItem = createFieldsMenuItem();
                content.appendChild(menuItem);
            } else if (item.id === 'tags') {
                const menuItem = createTagsMenuItem();
                content.appendChild(menuItem);
            } else if (item.id === 'relations') {
                const menuItem = createRelationsMenuItem();
                content.appendChild(menuItem);
            } else {
                const menuItem = createEditFeatureMenuItem(item.label, item.id);
                content.appendChild(menuItem);
            }
        });

        editScreen.appendChild(content);
        flexContainer.appendChild(editScreen);

        attachRiyadhGeometryEditRow(editScreen, lineData);

        // Sync Feature Type label immediately so the sidebar never shows empty.
        (function syncFeatureTypeLabelNow() {
            const label = getCurrentFeatureLabel();
            const sel = document.getElementById('selectedFeatureName');
            const viz = document.getElementById('lineVisualizationFeatureName');
            if (sel) {
                sel.textContent = label;
            }
            if (viz) {
                viz.textContent = label;
            }
        })();

        updateRiyadhRoadFeatureContextLine(lineData);

        setTimeout(function() {
            updateFeatureTypeLabelDisplay();
            // Update visualization - use request geometry if available
            if (requestGeometry) {
                updateFeatureTypeVisualizationFromGeometry(requestGeometry);
            } else {
                updateFeatureTypeVisualization();
            }
                                   
        }, 100);
    }

    function updateFeatureTypeLabelDisplay() {
        const labelToDisplay = getCurrentFeatureLabel();
        
        const selectedFeatureName = document.getElementById('selectedFeatureName');
        if (selectedFeatureName) {
            selectedFeatureName.textContent = labelToDisplay;
        }
        
        const visualizationFeatureName = document.getElementById('lineVisualizationFeatureName');
        if (visualizationFeatureName) {
            visualizationFeatureName.textContent = labelToDisplay;
        }
    }

    function updateSearchFeatureScreenSelection() {
        if (!currentFeatureLabel) return;

        const dropdownsContainer = document.getElementById('lineDropdownsContainer');
        if (!dropdownsContainer) return;

        if (currentFeatureLabel === 'Line') {
            return;
        }

        const dropdowns = dropdownsContainer.querySelectorAll('[role="menu"]');
        let found = false;
        
        dropdowns.forEach(function(menu) {
            const selectedValue = menu.getAttribute('data-selected-value');
            if (selectedValue) {
                const items = menu.querySelectorAll('[role="menuitem"]');
                items.forEach(function(item) {
                    const itemValue = item.getAttribute('data-value');
                    const itemLabel = item.textContent.trim();
                    if (itemLabel === currentFeatureLabel || itemValue === currentFeatureLabel) {
                        const dropdownLabel = menu.getAttribute('data-dropdown-label');
                        if (dropdownLabel) {
                            updateDropdownButtonText(dropdownLabel, currentFeatureLabel);
                            found = true;
                        }
                    }
                });
            }
        });
    }

    function hideSidePanelDefaultElements() {
        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) return;

        const flexContainer = document.getElementById('sidePanelInner') || sidePanel.querySelector('.h-full.flex.flex-col');
        if (!flexContainer) return;

        const children = Array.from(flexContainer.children);
        children.forEach(function(child) {
            if (child.id !== 'editFeatureScreen') {
                child.style.display = 'none';
            }
        });
    }

    function showSidePanelDefaultElements() {
        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) return;

        const flexContainer = document.getElementById('sidePanelInner') || sidePanel.querySelector('.h-full.flex.flex-col');
        if (!flexContainer) return;

        const children = Array.from(flexContainer.children);
        children.forEach(function(child) {
            if (child.id !== 'editFeatureScreen') {
                child.style.display = 'block';
            }
        });
    }

    function createFeatureTypeMenuItem() {
        const container = document.createElement('div');
        container.className = 'border-b border-zinc-200';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-zinc-100 transition-colors group';
        button.setAttribute('data-menu-item', 'featureType');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-semibold text-zinc-900 group-hover:text-black transition-colors';
        labelSpan.textContent = 'Feature Type';

        button.appendChild(labelSpan);

        const content = document.createElement('div');
        content.id = 'content-featureType';
        content.className = 'px-6 pb-4 pt-2';
        content.setAttribute('data-content', 'featureType');

        const featureTypeSelector = createFeatureTypeSelector();
        content.appendChild(featureTypeSelector);

        let isExpanded = true;

        button.addEventListener('click', function() {
            isExpanded = !isExpanded;
            if (isExpanded) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        container.appendChild(button);
        container.appendChild(content);

        return container;
    }

    function createFeatureTypeSelector() {
        const labelToSet = getCurrentFeatureLabel();
        
        const container = document.createElement('div');
        container.className = 'w-full';

        const selectorContainer = document.createElement('div');
        selectorContainer.className = 'flex items-center gap-3 justify-between';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'flex items-center gap-3 min-w-0';

        const visualizationContainer = document.createElement('div');
        visualizationContainer.id = 'featureTypeVisualization';
        visualizationContainer.className =
            'map-feature-type-symbology-preview flex-shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 transition-opacity';
        visualizationContainer.style.width = '80px';
        visualizationContainer.style.height = '40px';
        
        // Check if we're in view-only mode (manager viewing request)
        const editScreen = document.getElementById('editFeatureScreen');
        const isViewOnly = editScreen && editScreen.getAttribute('data-request-geometry');
        
        if (!isViewOnly) {
            visualizationContainer.setAttribute('title', 'Feature type preview');
        } else {
            visualizationContainer.style.cursor = 'default';
        }

        const selectedFeatureName = document.createElement('div');
        selectedFeatureName.id = 'selectedFeatureName';
        selectedFeatureName.className = 'text-sm font-semibold text-zinc-900 truncate';
        selectedFeatureName.textContent = labelToSet;
        
        if (!isViewOnly) {
            selectedFeatureName.setAttribute('title', labelToSet);
        } else {
            selectedFeatureName.style.cursor = 'default';
        }

        leftGroup.appendChild(visualizationContainer);
        leftGroup.appendChild(selectedFeatureName);
        selectorContainer.appendChild(leftGroup);

        if (!isViewOnly) {
            const changeBtn = document.createElement('button');
            changeBtn.type = 'button';
            changeBtn.className = 'flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 transition-colors';
            changeBtn.textContent = 'Change';
            changeBtn.addEventListener('click', function() {
                updateSearchFeatureScreenSelection();
                showLineSidePanel();
            });
            selectorContainer.appendChild(changeBtn);
        }

        container.appendChild(selectorContainer);

        const contextLine = document.createElement('p');
        contextLine.id = 'riyadhRoadFeatureContextLine';
        contextLine.className = 'mt-2 text-[11px] text-zinc-500 leading-snug hidden';
        contextLine.setAttribute('aria-label', 'Road summary');
        container.appendChild(contextLine);

        return container;
    }

    // Update Feature Type visualization from request geometry (for manager viewing requests).
    function updateFeatureTypeVisualizationFromGeometry(geometry) {
        const container = document.getElementById('featureTypeVisualization');
        if (!container || !geometry) return;

        // Normalize any GeoJSON geometry (LineString, MultiLineString, GeometryCollection, etc.)
        // to a simple LineString so Riyadh roads and other multi-part geometries still render.
        const normalized = normalizeToLineStringGeometry(geometry);
        const coordinates = normalized && normalized.coordinates ? normalized.coordinates : null;

        if (!coordinates || coordinates.length < 2) {
            container.innerHTML = '';
            return;
        }

        renderFeatureTypeVisualization(container, coordinates);
    }

    function updateFeatureTypeVisualization() {
        const container = document.getElementById('featureTypeVisualization');
        if (!container) {
            return;
        }

        const editScreen = document.getElementById('editFeatureScreen');
        if (editScreen && editScreen.getAttribute('data-request-geometry')) {
            try {
                const requestGeometry = JSON.parse(editScreen.getAttribute('data-request-geometry'));
                if (requestGeometry && requestGeometry.coordinates) {
                    let coords = requestGeometry.coordinates;
                    if (requestGeometry.type === 'MultiLineString' && Array.isArray(coords) && coords.length) {
                        coords = coords[0] || [];
                    }
                    if (coords && coords.length >= 2) {
                        renderFeatureTypeVisualization(container, coords);
                        return;
                    }
                }
            } catch (e) {
            }
        }

        // Approved line / tile road editing: use their geometry even when no TerraDraw selection exists.
        const externalGeometry = getBestAvailableSelectedGeometry();
        if (externalGeometry) {
            const normalized = normalizeToLineStringGeometry(externalGeometry);
            if (normalized && normalized.coordinates && normalized.coordinates.length >= 2) {
                renderFeatureTypeVisualization(container, normalized.coordinates);
                return;
            }
        }

        if (!currentLineId || !drawInstance) {
            container.innerHTML = '';
            return;
        }

        try {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === currentLineId; });

            if (!feature || !feature.geometry || feature.geometry.type !== 'LineString') {
                container.innerHTML = '';
                return;
            }

            const coordinates = feature.geometry.coordinates;
            if (!coordinates || coordinates.length < 2) {
                container.innerHTML = '';
                return;
            }

            renderFeatureTypeVisualization(container, coordinates);
        } catch (error) {
            if (container) container.innerHTML = '';
        }
    }

    // Render the Feature Type visualization SVG (compact preview next to the label).
    function renderFeatureTypeVisualization(container, coordinates) {
        if (!container || !coordinates || coordinates.length < 2) {
            if (container) container.innerHTML = '';
            return;
        }

        try {
            const width = 80;
            const height = 40;
            const padding = 6;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coordinates.forEach(function(coord) {
                minX = Math.min(minX, coord[0]);
                minY = Math.min(minY, coord[1]);
                maxX = Math.max(maxX, coord[0]);
                maxY = Math.max(maxY, coord[1]);
            });

            const rangeX = maxX - minX || 0.001;
            const rangeY = maxY - minY || 0.001;
            const scaleX = (width - padding * 2) / rangeX;
            const scaleY = (height - padding * 2) / rangeY;
            const scale = Math.min(scaleX, scaleY) * 0.82;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.style.display = 'block';

            let pathData = 'M ';
            coordinates.forEach(function(coord, index) {
                const x = (coord[0] - minX) * scale + padding;
                const y = height - ((coord[1] - minY) * scale + padding);
                if (index === 0) {
                    pathData += x.toFixed(2) + ' ' + y.toFixed(2);
                } else {
                    pathData += ' L ' + x.toFixed(2) + ' ' + y.toFixed(2);
                }
            });

            const featureLabel = getCurrentFeatureLabel();
            const style = getEffectiveVisualizationStyle(featureLabel);
            if (!style) {
                renderPreviewPlaceholder(container, 'Loading symbology…');
                rerenderOnCatalogLoaded(function() {
                    renderFeatureTypeVisualization(container, coordinates);
                });
                return;
            }
            const scaleFactor = 0.32;
            const svgDashMini = dasharrayToSvg(style);
            appendSvgLinePathsWithMapSelectionCasing(svg, pathData, style, svgDashMini, scaleFactor);

            container.innerHTML = '';
            container.appendChild(svg);
        } catch (e) {
            if (container) container.innerHTML = '';
        }
    }

    function createFieldsMenuItem() {
        window.selectedFields = [];
        const container = document.createElement('div');
        container.className = 'border-b border-zinc-200';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-zinc-100 transition-colors group';
        button.setAttribute('data-menu-item', 'fields');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-semibold text-zinc-900 group-hover:text-black transition-colors';
        labelSpan.textContent = 'Fields';

        button.appendChild(labelSpan);

        const content = document.createElement('div');
        content.id = 'content-fields';
        content.className = 'px-6 py-4';
        content.setAttribute('data-content', 'fields');

        const fieldsContainer = document.createElement('div');
        fieldsContainer.className = 'space-y-3';
        fieldsContainer.id = 'fields-container';

        const existingFieldsContainer = document.createElement('div');
        existingFieldsContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-3';

        const nameField = createFieldItem('Road Label', false, true, true);
        existingFieldsContainer.appendChild(nameField);

        const commonNameInput = document.createElement('input');
        commonNameInput.type = 'text';
        commonNameInput.id = 'sidebar-feature-name-input';
        commonNameInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-0 transition-all';
        commonNameInput.placeholder = '';
        existingFieldsContainer.appendChild(commonNameInput);

        fieldsContainer.appendChild(existingFieldsContainer);

        const addFieldSection = document.createElement('div');
        addFieldSection.className = 'space-y-1.5';
        addFieldSection.id = 'add-field-section';

        const addFieldLabel = document.createElement('label');
        addFieldLabel.className = 'text-xs text-zinc-600';
        addFieldLabel.textContent = 'Add field:';
        addFieldSection.appendChild(addFieldLabel);

        const addFieldDropdown = document.createElement('div');
        addFieldDropdown.className = 'relative';
        addFieldDropdown.id = 'add-field-dropdown';

        const dropdownInput = document.createElement('input');
        dropdownInput.type = 'text';
        dropdownInput.className = 'w-full ms-sidebar-input bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all cursor-pointer';
        dropdownInput.placeholder = 'Description, Fix Me, Image...';
        dropdownInput.readOnly = true;
        dropdownInput.id = 'add-field-input';

        const dropdownChevron = document.createElement('div');
        dropdownChevron.className = 'absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none';
        dropdownChevron.innerHTML = '<svg class="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 hidden';
        dropdownMenu.id = 'add-field-menu';

        const fieldOptions = ['Description', 'Fix Me', 'Image', 'Last Checked Date', 'Mapillary Image ID', 'Note', 'Panoramax Image ID', 'Website'];
        fieldOptions.forEach(function(option) {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 cursor-pointer flex items-center first:rounded-t-lg last:rounded-b-lg';
            menuItem.setAttribute('data-field', option.toLowerCase().replace(/\s+/g, '-'));
            menuItem.textContent = option;
            menuItem.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleFieldSelection(option, fieldsContainer);
            });
            dropdownMenu.appendChild(menuItem);
        });

        if (typeof selectedFields === 'undefined') {
            window.selectedFields = [];
        }

        dropdownInput.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdownMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', function(e) {
            if (!addFieldDropdown.contains(e.target)) {
                dropdownMenu.classList.add('hidden');
            }
        });

        addFieldDropdown.appendChild(dropdownInput);
        addFieldDropdown.appendChild(dropdownChevron);
        addFieldDropdown.appendChild(dropdownMenu);
        addFieldSection.appendChild(addFieldDropdown);

        fieldsContainer.appendChild(addFieldSection);

        const roadClosureSection = document.createElement('div');
        roadClosureSection.className = 'mt-4 pt-3 border-t border-zinc-200';

        const roadClosureLabel = document.createElement('div');
        roadClosureLabel.className = 'text-xs font-medium text-zinc-600 mb-2';
        roadClosureLabel.textContent = 'Road Closure';
        roadClosureSection.appendChild(roadClosureLabel);

        const roadClosureToggleRow = document.createElement('div');
        roadClosureToggleRow.className = 'flex items-center justify-between gap-3';

        const roadClosureNoLabel = document.createElement('span');
        roadClosureNoLabel.className = 'text-xs font-medium text-zinc-800';
        roadClosureNoLabel.textContent = 'NO';

        const roadClosureYesLabel = document.createElement('span');
        roadClosureYesLabel.className = 'text-xs font-medium text-zinc-400';
        roadClosureYesLabel.textContent = 'YES';

        const roadClosureToggleButton = document.createElement('button');
        roadClosureToggleButton.type = 'button';
        roadClosureToggleButton.className = 'relative inline-flex h-6 w-11 items-center rounded-full bg-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 focus:ring-offset-white';
        roadClosureToggleButton.setAttribute('aria-pressed', 'false');
        roadClosureToggleButton.setAttribute('aria-label', 'Toggle road closure');

        const roadClosureToggleKnob = document.createElement('span');
        roadClosureToggleKnob.className = 'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform translate-x-0';

        roadClosureToggleButton.appendChild(roadClosureToggleKnob);

        function paintRoadClosureToggle() {
            const closed = !!window.currentRoadClosureState;
            if (closed) {
                roadClosureToggleButton.classList.remove('bg-zinc-300');
                roadClosureToggleButton.classList.add('bg-red-600');
                roadClosureToggleKnob.classList.remove('translate-x-0');
                roadClosureToggleKnob.classList.add('translate-x-5');
                roadClosureToggleButton.setAttribute('aria-pressed', 'true');
                roadClosureNoLabel.classList.remove('text-zinc-800');
                roadClosureNoLabel.classList.add('text-zinc-400');
                roadClosureYesLabel.classList.remove('text-zinc-400');
                roadClosureYesLabel.classList.add('text-red-700');
            } else {
                roadClosureToggleButton.classList.remove('bg-red-600');
                roadClosureToggleButton.classList.add('bg-zinc-300');
                roadClosureToggleKnob.classList.remove('translate-x-5');
                roadClosureToggleKnob.classList.add('translate-x-0');
                roadClosureToggleButton.setAttribute('aria-pressed', 'false');
                roadClosureNoLabel.classList.remove('text-zinc-400');
                roadClosureNoLabel.classList.add('text-zinc-800');
                roadClosureYesLabel.classList.remove('text-red-700');
                roadClosureYesLabel.classList.add('text-zinc-400');
            }
        }

        window.__paintRoadClosureToggle = paintRoadClosureToggle;

        roadClosureToggleButton.addEventListener('click', function (e) {
            e.preventDefault();
            const next = !window.getCurrentRoadClosure();
            window.currentRoadClosureState = next;
            paintRoadClosureToggle();
            patchRoadClosureOnSelectionContext(next);
            refreshSymbologyAfterRoadClosureChange();
        });

        roadClosureToggleRow.appendChild(roadClosureNoLabel);
        roadClosureToggleRow.appendChild(roadClosureToggleButton);
        roadClosureToggleRow.appendChild(roadClosureYesLabel);

        roadClosureSection.appendChild(roadClosureToggleRow);

        paintRoadClosureToggle();

        fieldsContainer.appendChild(roadClosureSection);
        content.appendChild(fieldsContainer);

        let isExpanded = true;

        button.addEventListener('click', function() {
            isExpanded = !isExpanded;
            if (isExpanded) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        container.appendChild(button);
        container.appendChild(content);

        return container;
    }

    function createFieldItem(label, hasRedDot, hasInfoIcon, hasPlusIcon) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'flex items-center justify-between py-1.5';

        const leftSection = document.createElement('div');
        leftSection.className = 'flex items-center flex-1';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-xs text-zinc-900';
        labelSpan.textContent = label;
        leftSection.appendChild(labelSpan);

        fieldContainer.appendChild(leftSection);

        const rightSection = document.createElement('div');
        rightSection.className = 'flex items-center gap-1.5 flex-shrink-0';

        if (hasInfoIcon) {
            const infoButton = document.createElement('button');
            infoButton.type = 'button';
            infoButton.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
            infoButton.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
            rightSection.appendChild(infoButton);
        }

        if (hasPlusIcon) {
            const plusButtonWrapper = document.createElement('div');
            plusButtonWrapper.className = 'relative group';

            const plusButton = document.createElement('button');
            plusButton.type = 'button';
            plusButton.className = 'w-5 h-5 flex items-center justify-center rounded-lg bg-zinc-200 hover:bg-zinc-300 transition-colors';
            plusButton.innerHTML = '<svg class="w-3 h-3 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>';

            const tooltip = document.createElement('div');
            tooltip.className = 'absolute right-0 top-full mt-1.5 px-2.5 py-1.5 bg-black text-white text-xs rounded whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none shadow-lg';
            tooltip.textContent = 'Add Multilingual Name';
            
            const tooltipArrow = document.createElement('div');
            tooltipArrow.className = 'absolute bottom-full right-3 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-black';
            tooltip.appendChild(tooltipArrow);

            plusButtonWrapper.appendChild(plusButton);
            plusButtonWrapper.appendChild(tooltip);
            rightSection.appendChild(plusButtonWrapper);

            plusButton.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                
                const fieldsContainer = document.getElementById('fields-container');
                if (fieldsContainer) {
                    addMultilingualNameField(fieldsContainer);
                }
            });
        }

        fieldContainer.appendChild(rightSection);

        return fieldContainer;
    }

    function createTagsMenuItem() {
        const container = document.createElement('div');
        container.className = 'border-b border-zinc-200';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-zinc-100 transition-colors group';
        button.setAttribute('data-menu-item', 'tags');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-semibold text-zinc-900 group-hover:text-black transition-colors';
        labelSpan.id = 'tags-label-span';
        labelSpan.textContent = 'Tags (0)';

        button.appendChild(labelSpan);
        
        function updateTagsCount(labelElement) {
            const tagsRowsContainer = document.getElementById('tags-rows-container');
            if (tagsRowsContainer && labelElement) {
                const tagRows = tagsRowsContainer.querySelectorAll('.flex.items-center.gap-2');
                const count = tagRows.length;
                labelElement.textContent = 'Tags (' + count + ')';
            }
        }
        
        function addTagRow(container, labelElement) {
            const tagRow = document.createElement('div');
            tagRow.className = 'flex items-center gap-2';
            const tagId = 'tag-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            tagRow.id = tagId;

            const leftDropdown = document.createElement('div');
            leftDropdown.className = 'relative flex-1 min-w-0';

            const leftInput = document.createElement('input');
            leftInput.type = 'text';
            leftInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all cursor-pointer';
            leftInput.placeholder = 'Add new tag';
            leftInput.readOnly = true;

            const leftChevron = document.createElement('div');
            leftChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
            leftChevron.innerHTML = '<svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

            const leftMenu = document.createElement('div');
            leftMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 hidden max-h-60 overflow-y-auto';

            const tagOptions = ['building', 'highway', 'source', 'name', 'surface', 'natural', 'addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'];
            tagOptions.forEach(function(option) {
                const menuItem = document.createElement('div');
                menuItem.className = 'px-3 py-2 text-xs text-zinc-900 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100 last:border-b-0';
                menuItem.textContent = option;
                menuItem.addEventListener('click', function(e) {
                    e.stopPropagation();
                    leftInput.value = option;
                    leftMenu.classList.add('hidden');
                    updateTagsCount(labelElement);
                });
                leftMenu.appendChild(menuItem);
            });

            leftInput.addEventListener('click', function(e) {
                e.stopPropagation();
                leftMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', function(e) {
                if (!leftDropdown.contains(e.target)) {
                    leftMenu.classList.add('hidden');
                }
            });

            leftDropdown.appendChild(leftInput);
            leftDropdown.appendChild(leftChevron);
            leftDropdown.appendChild(leftMenu);

            const rightInput = document.createElement('input');
            rightInput.type = 'text';
            rightInput.className = 'flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
            rightInput.placeholder = '';

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors flex-shrink-0';
            deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
            deleteButton.addEventListener('click', function() {
                tagRow.remove();
                updateTagsCount(labelElement);
            });

            tagRow.appendChild(leftDropdown);
            tagRow.appendChild(rightInput);
            tagRow.appendChild(deleteButton);
            container.appendChild(tagRow);

            if (typeof window.tagsList === 'undefined') {
                window.tagsList = [];
            }
            window.tagsList.push(tagId);
            updateTagsCount(labelElement);
        }

        const content = document.createElement('div');
        content.id = 'content-tags';
        content.className = 'px-6 py-4';
        content.setAttribute('data-content', 'tags');

        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'space-y-2';
        tagsContainer.id = 'tags-rows-container';

        const addTagButton = document.createElement('button');
        addTagButton.type = 'button';
        addTagButton.className = 'w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-medium text-zinc-800 transition-colors';
        addTagButton.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span>Add Tag</span>';
        addTagButton.addEventListener('click', function() {
            addTagRow(tagsContainer, labelSpan);
        });

        content.appendChild(tagsContainer);
        content.appendChild(addTagButton);

        if (typeof window.tagsList === 'undefined') {
            window.tagsList = [];
        }

        let isExpanded = true;

        button.addEventListener('click', function() {
            isExpanded = !isExpanded;
            if (isExpanded) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        container.appendChild(button);
        container.appendChild(content);

        return container;
    }

    if (typeof window.selectedFields === 'undefined') {
        window.selectedFields = [];
    }

    function toggleFieldSelection(fieldName, fieldsContainer) {
        const fieldId = fieldName.toLowerCase().replace(/\s+/g, '-');
        if (!window.selectedFields) {
            window.selectedFields = [];
        }
        const index = window.selectedFields.indexOf(fieldId);
        
        if (index > -1) {
            window.selectedFields.splice(index, 1);
            removeFieldFromContainer(fieldId, fieldsContainer);
        } else {
            window.selectedFields.push(fieldId);
            addFieldToContainer(fieldName, fieldId, fieldsContainer);
        }
        
        updateAddFieldDisplay();
        const dropdownMenu = document.getElementById('add-field-menu');
        if (dropdownMenu) {
            dropdownMenu.classList.add('hidden');
        }
    }

    function updateAddFieldDisplay() {
        const dropdownInput = document.getElementById('add-field-input');
        if (dropdownInput) {
            if (!window.selectedFields || window.selectedFields.length === 0) {
                dropdownInput.value = '';
                dropdownInput.placeholder = 'Description, Fix Me, Image...';
            } else {
                const displayNames = window.selectedFields.map(function(fieldId) {
                    if (fieldId === 'description') return 'Description';
                    if (fieldId === 'fix-me') return 'Fix Me';
                    if (fieldId === 'image') return 'Image';
                    if (fieldId === 'last-checked-date') return 'Last Checked Date';
                    if (fieldId === 'mapillary-image-id') return 'Mapillary Image ID';
                    if (fieldId === 'note') return 'Note';
                    if (fieldId === 'panoramax-image-id') return 'Panoramax Image ID';
                    if (fieldId === 'website') return 'Website';
                    return fieldId;
                });
                dropdownInput.value = displayNames.join(', ');
                dropdownInput.placeholder = '';
            }
        }
    }

    function addFieldToContainer(fieldName, fieldId, fieldsContainer) {
        const existingFieldsContainer = fieldsContainer.querySelector('.ms-sidebar-field-group');
        const addFieldSection = document.getElementById('add-field-section');
        
        let fieldElement = null;
        
        if (fieldId === 'description') {
            fieldElement = createDescriptionField(fieldId);
        } else if (fieldId === 'fix-me') {
            fieldElement = createFixMeField(fieldId);
        } else if (fieldId === 'image') {
            fieldElement = createImageField(fieldId);
        } else if (fieldId === 'last-checked-date') {
            fieldElement = createLastCheckedDateField(fieldId);
        } else if (fieldId === 'mapillary-image-id') {
            fieldElement = createMapillaryImageIdField(fieldId);
        } else if (fieldId === 'note') {
            fieldElement = createNoteField(fieldId);
        } else if (fieldId === 'panoramax-image-id') {
            fieldElement = createPanoramaxImageIdField(fieldId);
        } else if (fieldId === 'website') {
            fieldElement = createWebsiteField(fieldId);
        }
        
        if (fieldElement && existingFieldsContainer && addFieldSection) {
            fieldsContainer.insertBefore(fieldElement, addFieldSection);
        } else if (fieldElement && existingFieldsContainer) {
            existingFieldsContainer.parentNode.insertBefore(fieldElement, existingFieldsContainer.nextSibling);
        } else if (fieldElement) {
            fieldsContainer.appendChild(fieldElement);
        }
    }

    function removeFieldFromContainer(fieldId, fieldsContainer) {
        const fieldElement = document.getElementById('field-' + fieldId);
        if (fieldElement) {
            fieldElement.remove();
        }
    }

    function createRelationsMenuItem() {
        const container = document.createElement('div');
        container.className = 'border-b border-zinc-200';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-zinc-100 transition-colors group';
        button.setAttribute('data-menu-item', 'relations');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-semibold text-zinc-900 group-hover:text-black transition-colors';
        labelSpan.id = 'relations-label-span';
        labelSpan.textContent = 'Relations (0)';

        button.appendChild(labelSpan);

        function updateRelationsCount(labelElement) {
            const relationsRowsContainer = document.getElementById('relations-rows-container');
            if (relationsRowsContainer && labelElement) {
                const relationRows = relationsRowsContainer.querySelectorAll('.space-y-2');
                const count = relationRows.length;
                labelElement.textContent = 'Relations (' + count + ')';
            }
        }

        function addRelationRow(container, labelElement) {
            const relationRow = document.createElement('div');
            relationRow.className = 'space-y-2';
            const relationId = 'relation-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            relationRow.id = relationId;

            const parentRelationRow = document.createElement('div');
            parentRelationRow.className = 'flex items-center gap-2';

            const parentDropdown = document.createElement('div');
            parentDropdown.className = 'relative flex-1 min-w-0';

            const parentInput = document.createElement('input');
            parentInput.type = 'text';
            parentInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all cursor-pointer';
            parentInput.placeholder = 'Choose a parent relation';
            parentInput.value = 'New Relation';
            parentInput.readOnly = true;

            const parentChevron = document.createElement('div');
            parentChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
            parentChevron.innerHTML = '<svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

            const parentMenu = document.createElement('div');
            parentMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 hidden max-h-60 overflow-y-auto';

            const relationOptions = ['New Relation'];
            relationOptions.forEach(function(option) {
                const menuItem = document.createElement('div');
                menuItem.className = 'px-3 py-2 text-xs text-zinc-900 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100 last:border-b-0';
                menuItem.textContent = option;
                menuItem.addEventListener('click', function(e) {
                    e.stopPropagation();
                    parentInput.value = option;
                    parentMenu.classList.add('hidden');
                });
                parentMenu.appendChild(menuItem);
            });

            parentInput.addEventListener('click', function(e) {
                e.stopPropagation();
                parentMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', function(e) {
                if (!parentDropdown.contains(e.target)) {
                    parentMenu.classList.add('hidden');
                }
            });

            parentDropdown.appendChild(parentInput);
            parentDropdown.appendChild(parentChevron);
            parentDropdown.appendChild(parentMenu);

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors flex-shrink-0';
            deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
            deleteButton.addEventListener('click', function() {
                relationRow.remove();
                updateRelationsCount(labelElement);
            });

            parentRelationRow.appendChild(parentDropdown);
            parentRelationRow.appendChild(deleteButton);

            const roleInput = document.createElement('input');
            roleInput.type = 'text';
            roleInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-0 transition-all';
            roleInput.placeholder = 'Role';

            relationRow.appendChild(parentRelationRow);
            relationRow.appendChild(roleInput);
            container.appendChild(relationRow);

            if (typeof window.relationsList === 'undefined') {
                window.relationsList = [];
            }
            window.relationsList.push(relationId);
            updateRelationsCount(labelElement);
        }

        const content = document.createElement('div');
        content.id = 'content-relations';
        content.className = 'px-6 py-4';
        content.setAttribute('data-content', 'relations');

        const relationsContainer = document.createElement('div');
        relationsContainer.className = 'space-y-2';
        relationsContainer.id = 'relations-rows-container';

        const addRelationButton = document.createElement('button');
        addRelationButton.type = 'button';
        addRelationButton.className = 'w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-medium text-zinc-800 transition-colors';
        addRelationButton.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>';
        addRelationButton.addEventListener('click', function() {
            addRelationRow(relationsContainer, labelSpan);
        });

        content.appendChild(relationsContainer);
        content.appendChild(addRelationButton);

        if (typeof window.relationsList === 'undefined') {
            window.relationsList = [];
        }

        let isExpanded = true;

        button.addEventListener('click', function() {
            isExpanded = !isExpanded;
            if (isExpanded) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        container.appendChild(button);
        container.appendChild(content);

        return container;
    }

    function createDescriptionField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Description';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-0 transition-all resize-none';
        textarea.placeholder = 'Unknown';
        textarea.rows = 3;
        fieldContainer.appendChild(textarea);

        return fieldContainer;
    }

    function createFixMeField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Fix Me';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-0 transition-all resize-none';
        textarea.placeholder = 'Unknown';
        textarea.rows = 3;
        fieldContainer.appendChild(textarea);

        return fieldContainer;
    }

    function createImageField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Image';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        input.placeholder = 'https://example.com/photo.jpg';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createLastCheckedDateField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Last Checked Date';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative flex items-center gap-2';

        const input = document.createElement('input');
        input.type = 'date';
        input.className = 'flex-1 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        input.placeholder = 'YYYY-MM-DD';
        input.id = 'date-input-' + fieldId;
        inputWrapper.appendChild(input);

        const calendarIcon = document.createElement('button');
        calendarIcon.type = 'button';
        calendarIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer';
        calendarIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
        calendarIcon.addEventListener('click', function(e) {
            e.stopPropagation();
            input.showPicker();
        });
        inputWrapper.appendChild(calendarIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createMapillaryImageIdField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Mapillary Image ID';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        input.value = 'Unknown';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createNoteField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Note';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-0 transition-all resize-y';
        textarea.value = 'Unknown';
        textarea.rows = 3;
        fieldContainer.appendChild(textarea);

        return fieldContainer;
    }

    function createPanoramaxImageIdField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Panoramax Image ID';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        input.value = 'Unknown';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createWebsiteField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-zinc-900';
        label.textContent = 'Website';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            if (window.selectedFields) {
                const index = window.selectedFields.indexOf(fieldId);
                if (index > -1) {
                    window.selectedFields.splice(index, 1);
                }
            }
            fieldContainer.remove();
            updateAddFieldDisplay();
        });
        header.appendChild(deleteButton);

        fieldContainer.appendChild(header);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        input.value = 'https://example.com';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        externalLinkIcon.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            const url = input.value.trim();
            if (url) {
                let urlToOpen = url;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    urlToOpen = 'https://' + url;
                }
                window.open(urlToOpen, '_blank', 'noopener,noreferrer');
            }
        });
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function addMultilingualNameField(fieldsContainer) {
        const multilingualSection = document.createElement('div');
        multilingualSection.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2.5';

        const headerRow = document.createElement('div');
        headerRow.className = 'flex items-center justify-between';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-xs font-medium text-zinc-900';
        labelSpan.textContent = 'Multilingual Name';
        headerRow.appendChild(labelSpan);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            multilingualSection.remove();
        });
        headerRow.appendChild(deleteButton);

        multilingualSection.appendChild(headerRow);

        const languageDropdown = document.createElement('div');
        languageDropdown.className = 'relative';

        const languageSelect = document.createElement('select');
        languageSelect.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all appearance-none cursor-pointer';
        languageSelect.id = 'language-select-' + Date.now();

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Choose language';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        languageSelect.appendChild(defaultOption);

        const englishOption = document.createElement('option');
        englishOption.value = 'english';
        englishOption.textContent = 'English';
        languageSelect.appendChild(englishOption);

        const urduOption = document.createElement('option');
        urduOption.value = 'urdu';
        urduOption.textContent = 'Urdu';
        languageSelect.appendChild(urduOption);

        const arabicOption = document.createElement('option');
        arabicOption.value = 'arabic';
        arabicOption.textContent = 'Arabic';
        languageSelect.appendChild(arabicOption);

        const languageChevron = document.createElement('div');
        languageChevron.className = 'absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none';
        languageChevron.innerHTML = '<svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        languageDropdown.appendChild(languageSelect);
        languageDropdown.appendChild(languageChevron);
        multilingualSection.appendChild(languageDropdown);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-0 transition-all';
        nameInput.placeholder = 'Name';
        multilingualSection.appendChild(nameInput);

        const existingFieldsContainer = fieldsContainer.querySelector('.ms-sidebar-field-group');
        const addFieldSection = document.getElementById('add-field-section');
        
        if (existingFieldsContainer && addFieldSection) {
            fieldsContainer.insertBefore(multilingualSection, addFieldSection);
        } else if (existingFieldsContainer) {
            existingFieldsContainer.parentNode.insertBefore(multilingualSection, existingFieldsContainer.nextSibling);
        } else {
            fieldsContainer.appendChild(multilingualSection);
        }
    }

    function createEditFeatureMenuItem(label, id) {
        const container = document.createElement('div');
        container.className = 'border-b border-zinc-200';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-zinc-100 transition-colors group';
        button.setAttribute('data-menu-item', id);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-semibold text-zinc-900 group-hover:text-black transition-colors';
        labelSpan.textContent = label;

        button.appendChild(labelSpan);

        const content = document.createElement('div');
        content.id = 'content-' + id;
        content.className = 'px-6 py-4';
        content.setAttribute('data-content', id);

        let isExpanded = true;

        button.addEventListener('click', function() {
            isExpanded = !isExpanded;
            if (isExpanded) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        container.appendChild(button);
        container.appendChild(content);

        return container;
    }

    function createIconForLabel(label) {
        const iconContainer = document.createElement('div');
        iconContainer.className = 'flex-shrink-0 w-6 h-6 flex items-center justify-center';

        const folderContainer = document.createElement('div');
        folderContainer.className = 'w-5 h-5 rounded flex items-center justify-center';
        
        if (label.includes('Waterways')) {
            folderContainer.className += ' bg-sky-100';
        } else if (label.includes('Barrier')) {
            folderContainer.className += ' bg-red-100';
        } else if (label.includes('Natural')) {
            folderContainer.className += ' bg-emerald-100';
        } else {
            folderContainer.className += ' bg-zinc-200';
        }

        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('class', 'w-4 h-4');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'none');
        
        let strokeColor = '#71717a';
        if (label.includes('Waterways')) {
            strokeColor = '#0284c7';
        } else if (label.includes('Barrier')) {
            strokeColor = '#dc2626';
        } else if (label.includes('Natural')) {
            strokeColor = '#059669';
        }
        iconSvg.setAttribute('stroke', strokeColor);
        iconSvg.setAttribute('stroke-width', '2');

        let iconPath = '';

        if (label.includes('Major Roads') || label.includes('Minor Roads')) {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path><circle cx="8" cy="12" r="1.5" fill="currentColor"/><circle cx="16" cy="12" r="1.5" fill="currentColor"/><path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18"></path>';
        } else if (label.includes('Rails')) {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M6 10v4M12 10v4M18 10v4"></path>';
        } else if (label.includes('Paths')) {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m-4-8h8M8 8l4-4m0 0l4 4"></path>';
        } else if (label.includes('Waterways')) {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M3 15c2.5 0 4.5-2 7-2s4.5 2 7 2M3 12c2.5 0 4.5-2 7-2s4.5 2 7 2M3 9c2.5 0 4.5-2 7-2s4.5 2 7 2"></path>';
        } else if (label.includes('Barrier')) {
            iconPath = '<circle cx="12" cy="12" r="8"/><path stroke-linecap="round" d="M6 12h12" stroke-width="3"/><path stroke-linecap="round" d="M12 6v12" stroke-width="3"/>';
        } else if (label.includes('Natural')) {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M8 16v-4m0 0l-2-2m2 2l2-2m4 0v4m0-4l-2-2m2 2l2-2M4 20h16M12 8v4"></path>';
        } else if (label.includes('Utility')) {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>';
        } else {
            iconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>';
        }

        iconSvg.innerHTML = iconPath;
        folderContainer.appendChild(iconSvg);
        iconContainer.appendChild(folderContainer);

        return iconContainer;
    }

    function toggleDropdown(dropdownMenu) {
        const allDropdowns = document.querySelectorAll('[role="menu"]');
        allDropdowns.forEach(function(menu) {
            if (menu !== dropdownMenu) {
                menu.classList.add('hidden');
            }
        });

        dropdownMenu.classList.toggle('hidden');
    }

    function hideLineSidePanel() {
        const linePanelContent = document.getElementById('linePanelContent');
        if (linePanelContent) {
            linePanelContent.style.display = 'none';
        }
        const searchResults = document.getElementById('featureSearchResults');
        if (searchResults) {
            searchResults.style.display = 'block';
        }
    }

    function getCurrentLineId() {
        return currentLineId;
    }

    // Return a flat list of all feature types with category for search.
    // Matches the options used in populateDropdowns.
    function getFeatureTypesForSearch() {
        const categories = [
            { category: 'Major Roads', options: [
                { label: 'Motorway', value: 'motorway' },
                { label: 'Trunk Road', value: 'trunk_road' },
                { label: 'Primary Road', value: 'primary_road' },
                { label: 'Secondary Road', value: 'secondary_road' },
                { label: 'Tertiary Road', value: 'tertiary_road' },
                { label: 'Motorway Link', value: 'motorway_link' },
                { label: 'Trunk Link', value: 'trunk_link' },
                { label: 'Primary Link', value: 'primary_link' },
                { label: 'Secondary Link', value: 'secondary_link' },
                { label: 'Tertiary Link', value: 'tertiary_link' }
            ]},
            { category: 'Minor Roads', options: [
                { label: 'Minor/Unclassified Road', value: 'minor_unclassified' },
                { label: 'Residential Road', value: 'residential' },
                { label: 'Living Street', value: 'living_street' },
                { label: 'Service Road', value: 'service' },
                { label: 'Track / Land-Access Road', value: 'track' }
            ]},
            { category: 'Rails', options: [
                { label: 'Train Track', value: 'train_track' },
                { label: 'Disused Railway', value: 'disused_railway' },
                { label: 'Tram Track', value: 'tram_track' },
                { label: 'Underground Railway Track', value: 'underground_railway' },
                { label: 'Narrow Guage Track', value: 'narrow_gauge' },
                { label: 'Light Rail Track', value: 'light_rail' },
                { label: 'Monorail Track', value: 'monorail' },
                { label: 'Funicular Track', value: 'funicular' }
            ]},
            { category: 'Paths', options: [
                { label: 'Path', value: 'path' },
                { label: 'Foot Path', value: 'foot_path' },
                { label: 'Marked Crossing', value: 'marked_crossing' },
                { label: 'Pavement', value: 'pavement' },
                { label: 'Informal Path', value: 'informal_path' },
                { label: 'Steps', value: 'steps' },
                { label: 'Cycle Path', value: 'cycle_path' },
                { label: 'Bridle Way', value: 'bridle_way' },
                { label: 'Pedestrian Street', value: 'pedestrian_street' }
            ]},
            { category: 'Waterways', options: [
                { label: 'Stream', value: 'stream' },
                { label: 'Drain', value: 'drain' },
                { label: 'River', value: 'river' },
                { label: 'Canal', value: 'canal' },
                { label: 'Ditch', value: 'ditch' }
            ]},
            { category: 'Barrier Features', options: [
                { label: 'Fence', value: 'fence' },
                { label: 'Guard Rail', value: 'guard_rail' },
                { label: 'Wall', value: 'wall' },
                { label: 'Retaining Wall', value: 'retaining_wall' },
                { label: 'Kerb', value: 'kerb' },
                { label: 'Gate', value: 'gate' },
                { label: 'Hedge', value: 'hedge' },
                { label: 'Trench', value: 'trench' },
                { label: 'Barrier', value: 'barrier' }
            ]},
            { category: 'Natural Features', options: [
                { label: 'Coast Line', value: 'coast_line' },
                { label: 'Tree Row', value: 'tree_row' },
                { label: 'Cliff', value: 'cliff' }
            ]},
            { category: 'Utility Features', options: [
                { label: 'Power Line', value: 'power_line' },
                { label: 'Minor Power Line', value: 'minor_power_line' },
                { label: 'Pipeline', value: 'pipeline' },
                { label: 'Power Cable', value: 'power_cable' }
            ]}
        ];
        const flat = [];
        categories.forEach(function(cat) {
            (cat.options || []).forEach(function(opt) {
                flat.push({ label: opt.label, value: opt.value, category: cat.category });
            });
        });
        return flat;
    }

    // Wire the Search features input and populate featureSearchResults.
    // Shows placeholder when empty; filters feature types when user types; on select, sets type and shows line panel.
    function setupFeatureSearch() {
        const searchInput = document.getElementById('featureSearch');
        const searchResults = document.getElementById('featureSearchResults');
        if (!searchInput || !searchResults) {
            return;
        }

        function renderSearchState(query) {
            const q = (query || '').trim().toLowerCase();
            const all = getFeatureTypesForSearch();

            if (q.length === 0) {
                searchResults.innerHTML = '<p class="text-xs text-zinc-500 px-1 py-4 leading-relaxed">Type to search feature types (e.g. Motorway, Path, Fence)</p>';
                searchResults.style.display = 'block';
                return;
            }

            const matches = all.filter(function(item) {
                return (item.label && item.label.toLowerCase().indexOf(q) >= 0) ||
                    (item.category && item.category.toLowerCase().indexOf(q) >= 0);
            });

            searchResults.innerHTML = '';
            searchResults.style.display = 'block';

            if (matches.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-xs text-zinc-500 px-2 py-4';
                empty.textContent = 'No feature types match your search.';
                searchResults.appendChild(empty);
                return;
            }

            matches.forEach(function(item) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'w-full text-left px-3 py-2.5 text-sm text-zinc-900 hover:bg-zinc-100 rounded-lg border border-transparent hover:border-zinc-200/80 transition-colors flex items-center justify-between gap-2';
                const labelSpan = document.createElement('span');
                labelSpan.textContent = item.label;
                const catSpan = document.createElement('span');
                catSpan.className = 'text-xs text-zinc-500 flex-shrink-0';
                catSpan.textContent = item.category;
                btn.appendChild(labelSpan);
                btn.appendChild(catSpan);
                btn.addEventListener("click", function() {
                    const label = item.label;
                    currentFeatureLabel = label;
                    updateCurrentFeatureLabel(label);
                    searchInput.value = "";
                    renderSearchState("");
                    const approved = window.approvedLineBeingEdited;
                    if (approved && approved.id && approved.geometry) {
                        if (approved.is_riyadh_road) {
                            updateRiyadhRoadVisualization(approved.id, label, approved.geometry);
                        }
                        showLineSidePanel();
                    } else if (currentLineId) {
                        showEditFeatureScreen();
                    } else {
                        showLineSidePanel();
                    }
                });
                searchResults.appendChild(btn);
            });
        }

        searchInput.addEventListener('input', function() {
            renderSearchState(searchInput.value);
        });
        searchInput.addEventListener('focus', function() {
            renderSearchState(searchInput.value);
        });

        // Initial state: show hint when panel is visible
        renderSearchState('');
    }

    function populateDropdowns() {
        const majorRoadsData = [
            { label: 'Motorway', value: 'motorway' },
            { label: 'Trunk Road', value: 'trunk_road' },
            { label: 'Primary Road', value: 'primary_road' },
            { label: 'Secondary Road', value: 'secondary_road' },
            { label: 'Tertiary Road', value: 'tertiary_road' },
            { label: 'Motorway Link', value: 'motorway_link' },
            { label: 'Trunk Link', value: 'trunk_link' },
            { label: 'Primary Link', value: 'primary_link' },
            { label: 'Secondary Link', value: 'secondary_link' },
            { label: 'Tertiary Link', value: 'tertiary_link' }
        ];

        const minorRoadsData = [
            { label: 'Minor/Unclassified Road', value: 'minor_unclassified' },
            { label: 'Residential Road', value: 'residential' },
            { label: 'Living Street', value: 'living_street' },
            { label: 'Service Road', value: 'service' },
            { label: 'Track / Land-Access Road', value: 'track' }
        ];

        const railsData = [
            { label: 'Train Track', value: 'train_track' },
            { label: 'Disused Railway', value: 'disused_railway' },
            { label: 'Tram Track', value: 'tram_track' },
            { label: 'Underground Railway Track', value: 'underground_railway' },
            { label: 'Narrow Guage Track', value: 'narrow_gauge' },
            { label: 'Light Rail Track', value: 'light_rail' },
            { label: 'Monorail Track', value: 'monorail' },
            { label: 'Funicular Track', value: 'funicular' }
        ];

        const pathsData = [
            { label: 'Path', value: 'path' },
            { label: 'Foot Path', value: 'foot_path' },
            { label: 'Marked Crossing', value: 'marked_crossing' },
            { label: 'Pavement', value: 'pavement' },
            { label: 'Informal Path', value: 'informal_path' },
            { label: 'Steps', value: 'steps' },
            { label: 'Cycle Path', value: 'cycle_path' },
            { label: 'Bridle Way', value: 'bridle_way' },
            { label: 'Pedestrian Street', value: 'pedestrian_street' }
        ];

        const waterwaysData = [
            { label: 'Stream', value: 'stream' },
            { label: 'Drain', value: 'drain' },
            { label: 'River', value: 'river' },
            { label: 'Canal', value: 'canal' },
            { label: 'Ditch', value: 'ditch' }
        ];

        const barrierFeaturesData = [
            { label: 'Fence', value: 'fence' },
            { label: 'Guard Rail', value: 'guard_rail' },
            { label: 'Wall', value: 'wall' },
            { label: 'Retaining Wall', value: 'retaining_wall' },
            { label: 'Kerb', value: 'kerb' },
            { label: 'Gate', value: 'gate' },
            { label: 'Hedge', value: 'hedge' },
            { label: 'Trench', value: 'trench' },
            { label: 'Barrier', value: 'barrier' }
        ];

        const naturalFeaturesData = [
            { label: 'Coast Line', value: 'coast_line' },
            { label: 'Tree Row', value: 'tree_row' },
            { label: 'Cliff', value: 'cliff' }
        ];

        const utilityFeaturesData = [
            { label: 'Power Line', value: 'power_line' },
            { label: 'Minor Power Line', value: 'minor_power_line' },
            { label: 'Pipeline', value: 'pipeline' },
            { label: 'Power Cable', value: 'power_cable' }
        ];

        setTimeout(function() {
            const majorRoadsDropdown = document.getElementById('dropdown-major-roads...');
            if (majorRoadsDropdown) {
                populateDropdownMenu(majorRoadsDropdown, majorRoadsData);
            }

            const minorRoadsDropdown = document.getElementById('dropdown-minor-roads...');
            if (minorRoadsDropdown) {
                populateDropdownMenu(minorRoadsDropdown, minorRoadsData);
            }

            const railsDropdown = document.getElementById('dropdown-rails...');
            if (railsDropdown) {
                populateDropdownMenu(railsDropdown, railsData);
            }

            const pathsDropdown = document.getElementById('dropdown-paths...');
            if (pathsDropdown) {
                populateDropdownMenu(pathsDropdown, pathsData);
            }

            const waterwaysDropdown = document.getElementById('dropdown-waterways...');
            if (waterwaysDropdown) {
                populateDropdownMenu(waterwaysDropdown, waterwaysData);
            }

            const barrierFeaturesDropdown = document.getElementById('dropdown-barrier-features...');
            if (barrierFeaturesDropdown) {
                populateDropdownMenu(barrierFeaturesDropdown, barrierFeaturesData);
            }

            const naturalFeaturesDropdown = document.getElementById('dropdown-natural-features...');
            if (naturalFeaturesDropdown) {
                populateDropdownMenu(naturalFeaturesDropdown, naturalFeaturesData);
            }

            const utilityFeaturesDropdown = document.getElementById('dropdown-utility-features...');
            if (utilityFeaturesDropdown) {
                populateDropdownMenu(utilityFeaturesDropdown, utilityFeaturesData);
            }
        }, 50);
    }

    function populateDropdownMenu(dropdownMenu, options) {
        dropdownMenu.innerHTML = '';

        const dropdownLabel = dropdownMenu.getAttribute('data-dropdown-label');
        const dropdownContainer = dropdownMenu.parentElement;

        options.forEach(function(option) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'w-full text-left px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-50 transition-colors first:rounded-t-lg last:rounded-b-lg';
            item.textContent = option.label || option;
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-value', option.value || option);

            item.addEventListener("click", function() {
                const selectedValue = option.label || option;
                if (!selectedValue) return;
                currentFeatureLabel = selectedValue;
                updateCurrentFeatureLabel(selectedValue);

                dropdownMenu.classList.add("hidden");
                dropdownMenu.setAttribute("data-selected-value", option.value || option);

                if (dropdownContainer) {
                    const dropdownButton = dropdownContainer.querySelector("button");
                    if (dropdownButton && dropdownLabel) {
                        const labelSpan = dropdownButton.querySelector("span");
                        if (labelSpan) labelSpan.textContent = dropdownLabel;
                    }
                }

                const activeLineData = window.approvedLineBeingEdited || null;
                if (activeLineData) {
                    if (activeLineData.id && activeLineData.is_riyadh_road) {
                        updateRiyadhRoadVisualization(activeLineData.id, selectedValue, activeLineData.geometry);
                    }
                    
                    // Update side panel visualization if it's visible
                    const sidePanel = document.getElementById('editSidePanel');
                    const isSidePanelVisible = sidePanel && !sidePanel.classList.contains('-translate-x-full');
                    const svgContainer = document.getElementById('lineVisualizationSVG');
                    
                    if (isSidePanelVisible && svgContainer && activeLineData.geometry) {
                        updateLineVisualizationFromGeometry(activeLineData.geometry, selectedValue);
                    }
                    
                    // Preserve existing data when changing feature type
                    // Store current fields, tags, and relations data before showing edit screen
                    const existingFieldsData = activeLineData.fields_data || {};
                    const existingTagsData = activeLineData.tags_data || [];
                    const existingRelationsData = activeLineData.relations_data || [];
                    
                    // Update the feature label in the stored data
                    const updatedLineData = Object.assign({}, activeLineData, {
                        current_feature_label: selectedValue,
                        feature_type: selectedValue,
                        fields_data: existingFieldsData,
                        tags_data: existingTagsData,
                        relations_data: existingRelationsData
                    });
                    
                    // Update the stored active line data (Riyadh road context).
                    window.approvedLineBeingEdited = updatedLineData;
                    
                    // Show Edit Feature screen with updated feature label and preserved data
                    setTimeout(function() {
                        showEditFeatureScreen({
                            hideBackButton: false,
                            requestGeometry: activeLineData.geometry,
                            lineData: updatedLineData
                        });
                    }, 10);
                } else if (currentLineId) {
                    // Normal flow: editing a newly drawn line
                    selectLine(currentLineId);
                    setTimeout(function() {
                        showEditFeatureScreen();
                    }, 10);
                } else {
                    // No line selected, just update visualization
                    updateLineVisualization();
                }
            });

            dropdownMenu.appendChild(item);
        });
    }

    /** Blend a 6-digit hex line color toward white (edit-mode core, less harsh than #fff). */
    function mixHexTowardWhite(hex, amountTowardWhite) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) {
            return '#f1f5f9';
        }
        var n = parseInt(m[1], 16);
        var r = (n >> 16) & 255;
        var g = (n >> 8) & 255;
        var b = n & 255;
        var t = Math.max(0, Math.min(1, amountTowardWhite));
        r = Math.round(r + (255 - r) * t);
        g = Math.round(g + (255 - g) * t);
        b = Math.round(b + (255 - b) * t);
        function h2(x) {
            var h = x.toString(16);
            return h.length === 1 ? '0' + h : h;
        }
        return '#' + h2(r) + h2(g) + h2(b);
    }

    /**
     * GeoJSON selection overlay: dark outline + light ring under symbology core (map-line-selection).
     */
    function applySelectedOverlaySymbologyPaint(featureLabel) {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        ensureSelectedOverlayLayers();
        bringSelectedOverlayLayersToFront();
        const label = featureLabel || getCurrentFeatureLabel();
        const style = getEffectiveVisualizationStyle(label);
        if (!style) {
            syncRiyadhTileSelectionSuppressionForDraftClosure();
            return;
        }
        const isClosed = isRoadClosedForCurrentContext();
        const closureCatalog = getVisualizationStyle('Road Closure');
        const baseCatalog = getVisualizationStyle(label);
        const baseDasharray = getEffectiveDashArray(style);
        const lineDasharray =
            isClosed && closureCatalog && closureCatalog.lineDasharray && Array.isArray(closureCatalog.lineDasharray)
                ? closureCatalog.lineDasharray
                : baseDasharray;
        const casingOpts = getCasingOptionsForDash(lineDasharray);
        const w = Number(style.lineWidth) || 4;
        const c = style.lineColor || '#52525b';
        const coreW = Math.max(2, Math.min(8, w * 0.45));
        const coreLineW =
            isClosed && closureCatalog
                ? Math.max(
                      Number(closureCatalog.lineWidth) || 3,
                      baseCatalog ? Number(baseCatalog.lineWidth) || 0 : 0
                  )
                : w;
        const mls = mapLineSelection();
        // White inner stroke is only for vertex-edit mode; otherwise it reads as wrong symbology
        // (thick casing + white core) after "Done editing".
        const geomEditActive =
            typeof window.__roadGeometryEditActiveId !== 'undefined' &&
            window.__roadGeometryEditActiveId != null;
        const isDraftChange = isDraftRoadClosureChangeActive();

        // If the road is already closed in DB (not a draft toggle) and we're not in
        // vertex-edit mode, keep the basemap/tiles as the source of truth and do not
        // draw the GeoJSON overlay (prevents "selected road disappears" artifacts).
        if (!geomEditActive && !isDraftChange) {
            hideSelectedOverlayPaint();
            syncRiyadhTileSelectionSuppressionForDraftClosure();
            return;
        }
        try {
            if (map.getLayer(SELECTED_OVERLAY_GRADIENT_LAYER_ID)) {
                map.setPaintProperty(SELECTED_OVERLAY_GRADIENT_LAYER_ID, 'line-color', c);
                map.setPaintProperty(SELECTED_OVERLAY_GRADIENT_LAYER_ID, 'line-width', coreLineW);
                map.setPaintProperty(SELECTED_OVERLAY_GRADIENT_LAYER_ID, 'line-opacity', 1);
                map.setPaintProperty(SELECTED_OVERLAY_GRADIENT_LAYER_ID, 'line-dasharray', lineDasharray);
                try {
                    map.setLayoutProperty(
                        SELECTED_OVERLAY_GRADIENT_LAYER_ID,
                        'line-cap',
                        hasDashGap(lineDasharray) ? 'butt' : 'round'
                    );
                    map.setLayoutProperty(
                        SELECTED_OVERLAY_GRADIENT_LAYER_ID,
                        'line-join',
                        hasDashGap(lineDasharray) ? 'miter' : 'round'
                    );
                } catch (eLay) {}
            }
            if (isClosed) {
                if (map.getLayer(SELECTED_OVERLAY_OUTLINE_LAYER_ID)) {
                    map.setPaintProperty(SELECTED_OVERLAY_OUTLINE_LAYER_ID, 'line-opacity', 0);
                }
                if (map.getLayer(SELECTED_OVERLAY_RING_LAYER_ID)) {
                    map.setPaintProperty(SELECTED_OVERLAY_RING_LAYER_ID, 'line-opacity', 0);
                }
            } else if (mls) {
                mls.applyGeoJsonCasingFromCoreWidth(
                    map,
                    SELECTED_OVERLAY_OUTLINE_LAYER_ID,
                    SELECTED_OVERLAY_RING_LAYER_ID,
                    coreLineW,
                    lineDasharray,
                    casingOpts
                );
            }
            if (map.getLayer(SELECTED_OVERLAY_LINE_LAYER_ID)) {
                if (geomEditActive) {
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-color', mixHexTowardWhite(c, 0.5));
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-width', coreW);
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-opacity', 1);
                } else {
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-width', coreW);
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-opacity', 0);
                }
            }
        } catch (e) {
            // Non-critical
        }
        syncRiyadhTileSelectionSuppressionForDraftClosure();
    }

    /** Prefer fields_data.fclass (remote DB); else label→fclass from catalog (riyadh_label_to_fclass). */
    function resolveRiyadhFclassForFeatureState(featureLabel) {
        const snap = window.approvedLineBeingEdited || window.selectedRiyadhRoad || {};
        const fd = snap.fields_data && typeof snap.fields_data === 'object' ? snap.fields_data : {};
        const fromDb = String(fd.fclass || '').trim();
        if (fromDb) {
            return fromDb;
        }
        const cat = window.symbologyCatalog;
        const inv = cat && cat.riyadh_label_to_fclass;
        if (!inv) {
            return null;
        }
        const lab = (featureLabel != null ? String(featureLabel) : '').trim().toLowerCase();
        return inv[lab] || null;
    }

    // Update Riyadh road visualization on the map when feature type changes.
    function updateRiyadhRoadVisualization(roadId, newFeatureLabel, geometry) {
        // Keep the highlight selection in sync with the chosen road id.
        if (typeof window.setRiyadhRoadSelectedId === 'function') {
            if (!geometry) {
                window.setRiyadhRoadSelectedId(null);
            } else {
                window.setRiyadhRoadSelectedId(roadId);
            }
        }

        try {
            if (
                geometry &&
                roadId != null &&
                typeof window.applyRiyadhRoadDbFclassFromDatabase === 'function'
            ) {
                const fc = resolveRiyadhFclassForFeatureState(newFeatureLabel);
                if (fc) {
                    window.applyRiyadhRoadDbFclassFromDatabase(roadId, fc);
                }
            }
        } catch (eFs) {}

        // Riyadh tile selection core/outline/ring keep MapLibre data-driven paint (same
        // expressions as riyadh-roads-layer). db_fclass feature-state + filters provide
        // symbology; do not paint literals here or the core jumps away from the base road.

        if (geometry && typeof map !== 'undefined' && map) {
            applySelectedOverlaySymbologyPaint(newFeatureLabel);
        } else {
            syncRiyadhTileSelectionSuppressionForDraftClosure();
        }
    }

    function updateDropdownData(dropdownIndex, options) {
        const container = document.getElementById('lineDropdownsContainer');
        if (!container) return;

        const dropdowns = container.querySelectorAll('[role="menu"]');
        if (dropdownIndex >= 0 && dropdownIndex < dropdowns.length) {
            const dropdown = dropdowns[dropdownIndex];
            populateDropdownMenu(dropdown, options);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLineDrawing);
    } else {
        initLineDrawing();
    }

    window.lineDrawingHandler = {
        selectLine: selectLine,
        getCurrentLineId: getCurrentLineId,
        getCurrentFeatureLabel: getCurrentFeatureLabel,
        getDrawInstance: function() { return drawInstance; },
        updateDropdownData: updateDropdownData,
        updateCurrentFeatureLabel: updateCurrentFeatureLabel,
        updateFeatureTypeVisualization: updateFeatureTypeVisualization,
        updateFeatureTypeLabelDisplay: updateFeatureTypeLabelDisplay,
        showEditFeatureScreen: showEditFeatureScreen,
        addFieldToContainer: addFieldToContainer,
        updateAddFieldDisplay: updateAddFieldDisplay,
        addMultilingualNameField: addMultilingualNameField,
        updateRiyadhRoadVisualization: updateRiyadhRoadVisualization,
        normalizeToLineStringGeometry: normalizeToLineStringGeometry,
        showRiyadhRoadAsLineFeature: showRiyadhRoadAsLineFeature
    };
    
    window.addFieldToContainer = addFieldToContainer;
    window.updateAddFieldDisplay = updateAddFieldDisplay;
    window.addMultilingualNameField = addMultilingualNameField;
    
    window.getVisualizationStyle = getVisualizationStyle;
    window.parseRoadClosurePayloadValue = parseRoadClosurePayloadValue;
    window.syncRoadClosureStateAfterPersist = syncRoadClosureStateAfterPersist;
    window.removeMapLibreLineLayer = removeMapLibreLineLayer;
    window.clearVertexMarkers = clearVertexMarkers;
    window.clearCurrentLine = function() {
        if (currentLineId) {
            // Remove MapLibre layers
            removeMapLibreLineLayer(currentLineId);
            
            // Clear vertex markers
            clearVertexMarkers();
            
            // Reset current line ID
            // Note: We don't remove from TerraDraw as it may not be necessary
            // The line can stay in TerraDraw's snapshot, we just clear our visual representation
            currentLineId = null;
        }
    };

    // Local helpers to populate the edit sidepanel with external
    // line/road data (used when manager-requests.js is not present).
    function populateFieldsDataFromRoad(fieldsData) {
        const fieldsContainer = document.getElementById('fields-container');
        if (!fieldsContainer || !fieldsData) return;

        const nameEl = document.getElementById('sidebar-feature-name-input');
        if (nameEl) {
            const n = fieldsData.name != null ? String(fieldsData.name).trim() : '';
            const c = fieldsData.common_name != null ? String(fieldsData.common_name).trim() : '';
            nameEl.value = n || c || '';
        }

        if (fieldsData.multilingual_names && Array.isArray(fieldsData.multilingual_names)) {
            fieldsData.multilingual_names.forEach(function(multilingual) {
                if (multilingual.language && multilingual.name) {
                    let multilingualSection = null;
                    if (typeof window.addMultilingualNameField === 'function') {
                        window.addMultilingualNameField(fieldsContainer);
                        setTimeout(function() {
                            const multilingualSections = fieldsContainer.querySelectorAll('[id^="multilingual-"]');
                            if (multilingualSections.length > 0) {
                                multilingualSection = multilingualSections[multilingualSections.length - 1];
                                const languageSelect = multilingualSection.querySelector('select');
                                const nameInput = multilingualSection.querySelector('input[type="text"]');
                                if (languageSelect) languageSelect.value = multilingual.language;
                                if (nameInput) nameInput.value = multilingual.name;
                            }
                        }, 50);
                    } else {
                        // Fallback: simple multilingual field without helper
                        const multilingualDiv = document.createElement('div');
                        multilingualDiv.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2.5';
                        const label = document.createElement('div');
                        label.className = 'text-xs font-medium text-zinc-900';
                        label.textContent = 'Multilingual Name (' + multilingual.language + ')';
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400';
                        input.value = multilingual.name;
                        multilingualDiv.appendChild(label);
                        multilingualDiv.appendChild(input);
                        fieldsContainer.appendChild(multilingualDiv);
                    }
                }
            });
        }

        const fieldMappings = {
            'description': { id: 'description', name: 'Description' },
            'fix_me': { id: 'fix-me', name: 'Fix Me' },
            'image': { id: 'image', name: 'Image' },
            'last_checked_date': { id: 'last-checked-date', name: 'Last Checked Date' },
            'mapillary_image_id': { id: 'mapillary-image-id', name: 'Mapillary Image ID' },
            'note': { id: 'note', name: 'Note' },
            'panoramax_image_id': { id: 'panoramax-image-id', name: 'Panoramax Image ID' },
            'website': { id: 'website', name: 'Website' }
        };

        Object.keys(fieldMappings).forEach(function(fieldKey) {
            if (fieldsData[fieldKey]) {
                const fieldInfo = fieldMappings[fieldKey];
                const fieldId = fieldInfo.id;
                const existingField = document.getElementById('field-' + fieldId);
                if (!existingField) {
                    if (typeof window.addFieldToContainer === 'function') {
                        window.addFieldToContainer(fieldInfo.name, fieldId, fieldsContainer);
                        if (typeof window.selectedFields === 'undefined') {
                            window.selectedFields = [];
                        }
                        if (window.selectedFields.indexOf(fieldId) === -1) {
                            window.selectedFields.push(fieldId);
                        }
                        setTimeout(function() {
                            const fieldElement = document.getElementById('field-' + fieldId);
                            if (fieldElement) {
                                const input = fieldElement.querySelector('input, textarea');
                                if (input) {
                                    input.value = fieldsData[fieldKey];
                                }
                            }
                        }, 150);
                    }
                } else {
                    const input = existingField.querySelector('input, textarea');
                    if (input) {
                        input.value = fieldsData[fieldKey];
                    }
                }
            }
        });

        setTimeout(function() {
            if (typeof window.updateAddFieldDisplay === 'function') {
                window.updateAddFieldDisplay();
            }
        }, 200);
    }

    function populateTagsDataFromRoad(tagsData) {
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        const tagsLabel = document.getElementById('tags-label-span');

        if (!tagsRowsContainer || !tagsLabel) return;

        tagsRowsContainer.innerHTML = '';
        if (!Array.isArray(tagsData) || tagsData.length === 0) {
            tagsLabel.textContent = 'Tags (0)';
            return;
        }

        tagsData.forEach(function(tag) {
            if (tag.key || tag.value) {
                // Minimal inline version of createTagRow to avoid hard dependency
                const tagRow = document.createElement('div');
                tagRow.className = 'flex items-center gap-2';

                const keyInput = document.createElement('input');
                keyInput.type = 'text';
                keyInput.className = 'flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400';
                keyInput.value = tag.key || '';

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400';
                valueInput.value = tag.value || '';

                tagRow.appendChild(keyInput);
                tagRow.appendChild(valueInput);
                tagsRowsContainer.appendChild(tagRow);
            }
        });

        const count = tagsRowsContainer.querySelectorAll('.flex.items-center.gap-2').length;
        tagsLabel.textContent = 'Tags (' + count + ')';
    }

    function populateRelationsDataFromRoad(relationsData) {
        if (!Array.isArray(relationsData) || relationsData.length === 0) return;

        const relationsRowsContainer = document.getElementById('relations-rows-container');
        const relationsLabel = document.getElementById('relations-label-span');

        if (!relationsRowsContainer || !relationsLabel) return;

        relationsData.forEach(function(relation) {
            if (relation.parent_relation || relation.role) {
                const relationRow = document.createElement('div');
                relationRow.className = 'space-y-2';

                const header = document.createElement('div');
                header.className = 'flex items-center gap-2';

                const parentInput = document.createElement('input');
                parentInput.type = 'text';
                parentInput.className = 'flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400';
                parentInput.value = relation.parent_relation || 'New Relation';

                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors flex-shrink-0';
                deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m3 0V4a1 1 0 011-1h6a1 1 0 011 1v3m-9 0h10"></path></svg>';
                deleteButton.addEventListener('click', function() {
                    relationRow.remove();
                    const remaining = relationsRowsContainer.querySelectorAll('.space-y-2').length;
                    relationsLabel.textContent = 'Relations (' + remaining + ')';
                });

                header.appendChild(parentInput);
                header.appendChild(deleteButton);

                const roleInput = document.createElement('input');
                roleInput.type = 'text';
                roleInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400';
                roleInput.value = relation.role || '';

                relationRow.appendChild(header);
                relationRow.appendChild(roleInput);
                relationsRowsContainer.appendChild(relationRow);
            }
        });

        const count = relationsRowsContainer.querySelectorAll('.space-y-2').length;
        relationsLabel.textContent = 'Relations (' + count + ')';
    }

    function showRiyadhRoadAsLineFeature(lineFeatureData) {
        if (!lineFeatureData) return;

        if (window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
            window.roadGeometryEdit.stop();
        }

        const roadId = lineFeatureData.id || 'riyadh-road-' + Date.now();
        const featureLabel = lineFeatureData.current_feature_label || lineFeatureData.feature_type || 'Line';
        window.approvedLineBeingEdited = Object.assign({}, lineFeatureData, {
            id: roadId,
            _original_feature_label: lineFeatureData._original_feature_label || featureLabel
        });
        normalizeRiyadhRoadTagsFromFields(window.approvedLineBeingEdited);

        showEditFeatureScreen({
            hideBackButton: false,
            requestGeometry: lineFeatureData.geometry || null,
            lineData: window.approvedLineBeingEdited,
        });

        if (lineFeatureData.geometry && typeof map !== 'undefined' && map) {
            updateRiyadhRoadVisualization(roadId, featureLabel, lineFeatureData.geometry);
        }

        try {
            updateCurrentFeatureLabel(featureLabel);

            const snap = window.approvedLineBeingEdited || {};
            const fieldsData = snap.fields_data || {};
            const tagsData = snap.tags_data || [];
            const relationsData = snap.relations_data || [];

            setTimeout(function() {
                if (fieldsData) {
                    if (typeof window.populateFieldsData === 'function') {
                        window.populateFieldsData(fieldsData);
                    } else {
                        populateFieldsDataFromRoad(fieldsData);
                    }
                }
                if (tagsData && Array.isArray(tagsData)) {
                    if (typeof window.populateTagsData === 'function') {
                        window.populateTagsData(tagsData);
                    } else {
                        populateTagsDataFromRoad(tagsData);
                    }
                }
                if (relationsData && Array.isArray(relationsData)) {
                    if (typeof window.populateRelationsData === 'function') {
                        window.populateRelationsData(relationsData);
                    } else {
                        populateRelationsDataFromRoad(relationsData);
                    }
                }
                updateRiyadhRoadFeatureContextLine(window.approvedLineBeingEdited);
            }, 300);
        } catch (e) {}
    }

    window.showRiyadhRoadAsLineFeature = showRiyadhRoadAsLineFeature;

    // Expose selection utilities for other scripts (approved lines / tile roads).
    window.setSelectedOverlayGeometry = setSelectedOverlayGeometry;

    try {
        if (window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
            setSymbologyCatalog(window.symbologyCatalog);
        }
    } catch (e) {}
})();
