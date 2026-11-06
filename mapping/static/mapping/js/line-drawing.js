(function() {
    'use strict';

    let currentLineId = null;
    let drawInstance = null;
    let selectedLineId = null;
    let drawingLineId = null;
    let drawingMonitorInterval = null;
    let drawingDetectInterval = null;
    let svgObserver = null;
    let hideDefaultRenderingStarted = false;
    let lineDrawingListenersBound = false;
    let draftLineMapLayerGeneration = 0;
    /** Road label field stays locked until the user explicitly clicks Edit. */
    let roadLabelFieldEditing = false;

    let sidePanel = null;
    let sidePanelContent = null;
    let currentFeatureLabel = "Line";

    let symbologyStylesByLabel = null;

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function displayFeatureTypeLabel(label) {
        if (typeof window.displayFeatureTypeLabel === 'function') {
            return window.displayFeatureTypeLabel(label);
        }
        return label;
    }

    function displayFeatureCategoryLabel(label) {
        if (typeof window.displayFeatureCategoryLabel === 'function') {
            return window.displayFeatureCategoryLabel(label);
        }
        return label;
    }

    function riyadhShared() {
        return window.RiyadhRoadShared || null;
    }

    function mapLineSelection() {
        return window.MapLineSelection;
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

    function showToast(message, type) {
        if (message && window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(message, type || 'info');
        }
    }

    function notifyMapSelectionChanged() {
        try {
            window.dispatchEvent(new CustomEvent('map:selectionChanged'));
        } catch (e) {}
    }

    function notifyMapSelectionCleared() {
        try {
            window.dispatchEvent(new CustomEvent('map:selectionCleared'));
        } catch (e) {}
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

    function clearRiyadhRoadDeleteIntent() {
        window.__riyadhRoadDeleteIntent = false;
    }

    function armRiyadhRoadDeleteIntent() {
        window.__riyadhRoadDeleteIntent = true;
        if (window.__roadGeometryEditActiveId != null && window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
            window.roadGeometryEdit.stop();
        }
        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
        }
        syncRiyadhRoadMapOverlayFromContext();
    }

    function closeRoadDeleteDialog() {
        const dialog = document.getElementById('mspRoadDeleteDialog');
        if (dialog) {
            dialog.remove();
        }
        if (window.__roadDeleteConfirmTimer) {
            clearInterval(window.__roadDeleteConfirmTimer);
            window.__roadDeleteConfirmTimer = null;
        }
    }

    function openRoadDeleteDialog() {
        const target = getDeleteTargetFromContext();
        if (!target) {
            showToast(uiT('select_road_first', 'Select a road first.'), 'warning');
            return;
        }
        if (typeof window.isMapEditModeActive === 'function' && !window.isMapEditModeActive()) {
            if (typeof window.promptEnableEditMode === 'function') {
                window.promptEnableEditMode();
            }
            return;
        }
        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.assertRoadEditable === 'function' &&
            !window.PendingRoadLocks.assertRoadEditable(target.target_id)
        ) {
            return;
        }

        closeRoadDeleteDialog();

        const overlay = document.createElement('div');
        overlay.id = 'mspRoadDeleteDialog';
        overlay.className = 'msp-delete-dialog';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'mspRoadDeleteDialogTitle');

        const card = document.createElement('div');
        card.className = 'msp-delete-dialog__card';

        const role = ((document.body && document.body.getAttribute('data-user-role')) || '').toLowerCase();
        const isEditor = role === 'editor';

        const title = document.createElement('h3');
        title.id = 'mspRoadDeleteDialogTitle';
        title.className = 'msp-delete-dialog__title';
        title.textContent = uiT('delete_road_title', 'Delete this road?');

        const body = document.createElement('p');
        body.className = 'msp-delete-dialog__body';
        body.textContent = isEditor
            ? uiT('delete_road_body_editor', 'If you delete this road, it will go to the manager for review.')
            : uiT('delete_road_body_admin', 'This road will be deleted permanently.');

        const actions = document.createElement('div');
        actions.className = 'msp-delete-dialog__actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'msp-delete-dialog__cancel';
        cancelBtn.textContent = uiT('delete_road_cancel', 'Cancel');
        cancelBtn.addEventListener('click', function () {
            closeRoadDeleteDialog();
        });

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'msp-delete-dialog__confirm';
        confirmBtn.disabled = true;

        const confirmBase = isEditor
            ? uiT('delete_road_confirm_editor', 'Delete after review')
            : uiT('delete_road_confirm', 'Delete');

        let remaining = 3;
        function paintConfirmLabel() {
            confirmBtn.textContent = remaining > 0 ? (confirmBase + ' (' + remaining + ')') : confirmBase;
        }
        paintConfirmLabel();

        window.__roadDeleteConfirmTimer = setInterval(function () {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(window.__roadDeleteConfirmTimer);
                window.__roadDeleteConfirmTimer = null;
                confirmBtn.disabled = false;
                paintConfirmLabel();
                return;
            }
            paintConfirmLabel();
        }, 1000);

        confirmBtn.addEventListener('click', function () {
            if (confirmBtn.disabled) {
                return;
            }
            closeRoadDeleteDialog();
            armRiyadhRoadDeleteIntent();
            const saveBtn = document.getElementById('saveBtn');
            if (saveBtn) {
                saveBtn.click();
            }
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        card.appendChild(title);
        card.appendChild(body);
        card.appendChild(actions);
        overlay.appendChild(card);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closeRoadDeleteDialog();
            }
        });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') {
                closeRoadDeleteDialog();
                document.removeEventListener('keydown', onEsc);
            }
        });
        document.body.appendChild(overlay);
        cancelBtn.focus();
    }

    function buildRiyadhRoadDeleteRequestPayload() {
        const target = getDeleteTargetFromContext();
        if (!target) {
            return null;
        }
        const snapshot = target.snapshot || {};
        return {
            target_type: target.target_type,
            target_id: target.target_id,
            geometry: snapshot.geometry || null,
            feature_type: snapshot.feature_type || snapshot.current_feature_label || 'Line',
            current_feature_label: snapshot.current_feature_label || snapshot.feature_type || 'Line',
            fields_data: snapshot.fields_data || {},
            tags_data: snapshot.tags_data || [],
            relations_data: snapshot.relations_data || []
        };
    }

    window.__riyadhRoadDeleteIntent = false;
    window.clearRiyadhRoadDeleteIntent = clearRiyadhRoadDeleteIntent;
    window.buildRiyadhRoadDeleteRequestPayload = buildRiyadhRoadDeleteRequestPayload;

    const MAP_MOBILE_BREAKPOINT = '(max-width: 767px)';
    let mapSidePanelChromeReady = false;
    let mapSidePanelOpenedOnce = false;

    function syncRiyadhRoadMapOverlayFromContext() {
        try {
            const ext = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
            if (!ext || !ext.is_riyadh_road) {
                return;
            }
            const geom = getGeometryForRiyadhVisualization(ext);
            if (!geom) {
                return;
            }
            const roadId = ext.riyadh_road_id != null ? ext.riyadh_road_id : ext.id;
            const label = ext.current_feature_label || ext.feature_type || 'Line';
            setSelectedOverlayGeometry(geom);
            updateRiyadhRoadVisualization(roadId, label, geom);
        } catch (e) {}
    }

    function isMapMobileLayout() {
        return window.matchMedia(MAP_MOBILE_BREAKPOINT).matches;
    }

    function syncMapSidePanelBackdrop(visible) {
        const backdrop = document.getElementById('mapSidePanelBackdrop');
        if (!backdrop) {
            return;
        }
        if (visible && isMapMobileLayout()) {
            backdrop.classList.remove('hidden');
            backdrop.classList.add('is-visible');
            backdrop.setAttribute('aria-hidden', 'false');
        } else {
            backdrop.classList.remove('is-visible');
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
    }

    function shouldShowSidePanelExpandTab() {
        if (!mapSidePanelOpenedOnce) {
            return false;
        }
        if (hasMapRoadSelection()) {
            return true;
        }
        // Edit mode may still need the feature-type picker after a hide.
        return typeof window.isMapEditModeActive === 'function' && window.isMapEditModeActive();
    }

    function applyMapSidePanelOpen(open) {
        const sp = document.getElementById('editSidePanel');
        const collapseBtn = document.getElementById('sidePanelCollapseBtn');
        const expandTab = document.getElementById('sidePanelExpandTab');
        if (!sp) {
            return;
        }

        window.__mapSidePanelOpen = !!open;

        if (open) {
            mapSidePanelOpenedOnce = true;
            sp.classList.remove('msp-is-closed');
            syncMapSidePanelBackdrop(true);
            if (collapseBtn) {
                collapseBtn.classList.remove('hidden');
                collapseBtn.setAttribute('aria-expanded', 'true');
            }
            if (expandTab) {
                expandTab.classList.add('hidden');
                expandTab.setAttribute('aria-expanded', 'false');
            }
            return;
        }

        sp.classList.add('msp-is-closed');
        syncMapSidePanelBackdrop(false);
        if (collapseBtn) {
            collapseBtn.classList.add('hidden');
            collapseBtn.setAttribute('aria-expanded', 'false');
        }
        if (expandTab) {
            const showTab = shouldShowSidePanelExpandTab();
            expandTab.classList.toggle('hidden', !showTab);
            expandTab.setAttribute('aria-expanded', showTab ? 'true' : 'false');
        }
    }

    function initMapSidePanelChrome() {
        if (mapSidePanelChromeReady) {
            return;
        }
        const collapseBtn = document.getElementById('sidePanelCollapseBtn');
        const expandTab = document.getElementById('sidePanelExpandTab');
        const backdrop = document.getElementById('mapSidePanelBackdrop');
        if (!collapseBtn || !expandTab) {
            return;
        }
        if (collapseBtn.getAttribute('data-sidebar-bound') === '1') {
            mapSidePanelChromeReady = true;
            return;
        }
        collapseBtn.addEventListener('click', function() {
            applyMapSidePanelOpen(false);
        });
        expandTab.addEventListener('click', function() {
            applyMapSidePanelOpen(true);
        });
        if (backdrop) {
            backdrop.addEventListener('click', function() {
                if (isMapMobileLayout() && window.__mapSidePanelOpen) {
                    applyMapSidePanelOpen(false);
                }
            });
        }
        window.addEventListener('resize', function() {
            if (window.__mapSidePanelOpen) {
                syncMapSidePanelBackdrop(true);
            }
        });
        collapseBtn.setAttribute('data-sidebar-bound', '1');
        expandTab.setAttribute('data-sidebar-bound', '1');
        mapSidePanelChromeReady = true;
    }

    function hideRiyadhGeometryEditToolbar() {
        const group = document.getElementById('riyadhGeometryEditToolbarGroup');
        if (group) {
            group.classList.add('hidden');
        }
        clearRiyadhRoadDeleteIntent();
    }

    function syncRiyadhGeometryEditToolbarButton() {
        const btn = document.getElementById('riyadhGeometryEditToggleBtn');
        if (!btn) {
            return;
        }
        const ctx = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
        const rid = ctx && (ctx.riyadh_road_id != null ? ctx.riyadh_road_id : ctx.id);
        const active =
            window.__roadGeometryEditActiveId != null &&
            rid != null &&
            Number(window.__roadGeometryEditActiveId) === Number(rid);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.classList.toggle('is-active', active);
    }

    function syncRiyadhGeometryEditToolbar(editScreen, lineData) {
        const group = document.getElementById('riyadhGeometryEditToolbarGroup');
        if (!group) {
            return;
        }
        if (window.managerApprovalReviewActive) {
            hideRiyadhGeometryEditToolbar();
            return;
        }
        const readonly = editScreen &&
            typeof window.isMapEditModeActive === 'function' &&
            !window.isMapEditModeActive();
        if (readonly || !lineData || !lineData.is_riyadh_road) {
            hideRiyadhGeometryEditToolbar();
            return;
        }
        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.isRoadLocked === 'function'
        ) {
            const lockId =
                typeof window.PendingRoadLocks.resolveContextRoadId === 'function'
                    ? window.PendingRoadLocks.resolveContextRoadId(lineData)
                    : null;
            if (lockId != null && window.PendingRoadLocks.isRoadLocked(lockId)) {
                hideRiyadhGeometryEditToolbar();
                return;
            }
        }
        group.classList.remove('hidden');
        syncRiyadhGeometryEditToolbarButton();
    }

    function refreshRiyadhGeometryEditToolbar() {
        if (window.managerApprovalReviewActive) {
            hideRiyadhGeometryEditToolbar();
            return;
        }
        const editScreen = document.getElementById('editFeatureScreen');
        const lineData = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
        if (!editScreen || !lineData || !lineData.is_riyadh_road) {
            hideRiyadhGeometryEditToolbar();
            return;
        }
        syncRiyadhGeometryEditToolbar(editScreen, lineData);
    }

    function setupRiyadhGeometryEditToolbarOnce() {
        const btn = document.getElementById('riyadhGeometryEditToggleBtn');
        if (!btn || btn.getAttribute('data-bound') === '1') {
            return;
        }
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function() {
            if (window.__riyadhRoadDeleteIntent) {
                clearRiyadhRoadDeleteIntent();
            }
            if (window.__roadGeometryEditActiveId != null) {
                if (window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
                    window.roadGeometryEdit.stop();
                }
                return;
            }
            if (window.roadGeometryEdit && typeof window.roadGeometryEdit.startFromRiyadhContext === 'function') {
                window.roadGeometryEdit.startFromRiyadhContext();
            }
        });
    }

    window.syncRiyadhGeometryEditToolbarButton = syncRiyadhGeometryEditToolbarButton;
    window.refreshRiyadhGeometryEditToolbar = refreshRiyadhGeometryEditToolbar;
    window.hideRiyadhGeometryEditToolbar = hideRiyadhGeometryEditToolbar;

    function normalizeRiyadhRoadTagsFromFields(road) {
        const shared = riyadhShared();
        if (shared && typeof shared.normalizeRiyadhRoadTags === 'function') {
            shared.normalizeRiyadhRoadTags(road);
        }
    }

    window.syncRiyadhRoadMapOverlayFromContext = syncRiyadhRoadMapOverlayFromContext;
    window.applyMapSidePanelOpen = applyMapSidePanelOpen;
    window.initMapSidePanelChrome = initMapSidePanelChrome;

    // Selected-feature overlay (GeoJSON): same selection chrome as tile roads / drawn lines.
    const _MLS = mapLineSelection();
    if (!_MLS) {
        console.error('line-drawing.js requires mapping/js/map-line-selection.js before line-drawing.js');
        return;
    }
    const SELECTED_OVERLAY_SOURCE_ID = 'selected-road-overlay-v2';
    const SELECTED_OVERLAY_OUTLINE_LAYER_ID = _MLS.OVERLAY_OUTLINE_LAYER_ID;
    const SELECTED_OVERLAY_RING_LAYER_ID = _MLS.OVERLAY_RING_LAYER_ID;
    const SELECTED_OVERLAY_GRADIENT_LAYER_ID = _MLS.OVERLAY_GRADIENT_LAYER_ID;
    const SELECTED_OVERLAY_LINE_LAYER_ID = _MLS.OVERLAY_LINE_LAYER_ID;
    const SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID = _MLS.OVERLAY_CLOSURE_ICONS_LAYER_ID;
    const CLOSURE_ICON_IMAGE_ID =
        (window.RoadClosure && window.RoadClosure.ICON_IMAGE_ID) || 'road-closure-no-entry';

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
            const mls = mapLineSelection();
            const selLayout = mls.SELECTION_LINE_LAYOUT;
            if (!map.getLayer(SELECTED_OVERLAY_OUTLINE_LAYER_ID)) {
                map.addLayer({
                    id: SELECTED_OVERLAY_OUTLINE_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: selLayout,
                    paint: mls.geoJsonSelectionCasingPaint(),
                });
            }
            if (!map.getLayer(SELECTED_OVERLAY_RING_LAYER_ID)) {
                map.addLayer({
                    id: SELECTED_OVERLAY_RING_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: selLayout,
                    paint: mls.geoJsonSelectionRingPaint(),
                });
            }
            if (!map.getLayer(SELECTED_OVERLAY_GRADIENT_LAYER_ID)) {
                map.addLayer({
                    id: SELECTED_OVERLAY_GRADIENT_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: selLayout,
                    paint: Object.assign({}, mls.geoJsonSelectionCorePaint([1, 0]), { 'line-opacity': 0 }),
                });
            }
            if (!map.getLayer(SELECTED_OVERLAY_LINE_LAYER_ID)) {
                map.addLayer({
                    id: SELECTED_OVERLAY_LINE_LAYER_ID,
                    type: 'line',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: selLayout,
                    paint: Object.assign({}, mls.geoJsonSelectionCorePaint([1, 0]), { 'line-opacity': 0 }),
                });
            }

            ensureSelectedOverlayClosureIconLayer();
            bringSelectedOverlayLayersToFront();
        } catch (e) {
            // Non-critical
        }
    }

    function ensureSelectedOverlayClosureIconLayer() {
        if (typeof map === 'undefined' || !map || !map.getSource(SELECTED_OVERLAY_SOURCE_ID)) {
            return;
        }
        if (map.getLayer(SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID)) {
            return;
        }
        const ensureImage =
            window.RoadClosure && typeof window.RoadClosure.ensureMapImage === 'function'
                ? window.RoadClosure.ensureMapImage(map)
                : Promise.resolve(false);
        ensureImage.then(function (ok) {
            if (!ok || !map.getSource(SELECTED_OVERLAY_SOURCE_ID) || map.getLayer(SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID)) {
                return;
            }
            try {
                map.addLayer({
                    id: SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID,
                    type: 'symbol',
                    source: SELECTED_OVERLAY_SOURCE_ID,
                    layout: {
                        'icon-image': CLOSURE_ICON_IMAGE_ID,
                        'icon-size': 0.22,
                        'symbol-placement': 'line',
                        'symbol-spacing': 96,
                        'icon-rotation-alignment': 'map',
                        'icon-pitch-alignment': 'map',
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true,
                        visibility: 'none',
                    },
                    paint: {
                        'icon-opacity': 1,
                    },
                });
                bringSelectedOverlayLayersToFront();
                syncSelectedOverlayClosureIconsVisibility();
            } catch (eLayer) {}
        });
    }

    function syncSelectedOverlayClosureIconsVisibility() {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        ensureSelectedOverlayClosureIconLayer();
        if (!map.getLayer(SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID)) {
            return;
        }
        const geomEditActive =
            typeof window.__roadGeometryEditActiveId !== 'undefined' &&
            window.__roadGeometryEditActiveId != null;
        const overlayActive =
            geomEditActive || isDraftRoadClosureChangeActive() || !!window.__riyadhPostSaveOverlayActive;
        const show = overlayActive && isRoadClosedForCurrentContext();
        try {
            map.setLayoutProperty(
                SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID,
                'visibility',
                show ? 'visible' : 'none'
            );
        } catch (eVis) {}
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
                syncDraftClosureMapLayers();
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
        if (!catalog || typeof catalog !== 'object' || !catalog.styles_by_label) {
            return;
        }

        symbologyStylesByLabel = {};

        Object.keys(catalog.styles_by_label).forEach(function (rawLabel) {
            const normalizedKey = normalizeFeatureLabel(rawLabel);
            if (!normalizedKey) {
                return;
            }
            symbologyStylesByLabel[normalizedKey] = catalog.styles_by_label[rawLabel];
        });

        // Shared with map layers, approval preview, reshape legend, etc.
        window.symbologyCatalog = catalog;

        try {
            window.dispatchEvent(new CustomEvent('symbology:catalogLoaded', { detail: catalog }));
        } catch (e) {}
    }

    function ensureSymbologyCatalogRequested() {
        if (symbologyStylesByLabel !== null) {
            return;
        }
        if (window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
            setSymbologyCatalog(window.symbologyCatalog);
            return;
        }
        if (typeof window.__geotrakLoadSymbologyCatalog !== 'function') {
            return;
        }
        window
            .__geotrakLoadSymbologyCatalog()
            .then(function (data) {
                setSymbologyCatalog(data);
            })
            .catch(function () {});
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
        return !!data && window.parseRoadClosurePayloadValue(data.road_closure);
    }

    function closureFeatureLabel() {
        return (window.RoadClosure && window.RoadClosure.FEATURE_LABEL) || 'Road Closure';
    }

    function getEffectiveVisualizationStyle(featureLabel) {
        if (isRoadClosedForCurrentContext()) {
            return getVisualizationStyle(closureFeatureLabel());
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
            SELECTED_OVERLAY_LINE_LAYER_ID,
            SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID
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
        return !!(
            window.RoadClosure &&
            typeof window.RoadClosure.isDraftChange === 'function' &&
            window.RoadClosure.isDraftChange(
                window.initialRoadClosureState,
                window.currentRoadClosureState
            )
        );
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
            if (map.getLayer(SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID)) {
                map.setLayoutProperty(SELECTED_OVERLAY_CLOSURE_ICONS_LAYER_ID, 'visibility', 'none');
            }
        } catch (eHide) {}
    }

    function syncDraftClosureMapLayers() {
        const ext = window.approvedLineBeingEdited || window.selectedRiyadhRoad || null;
        const draftActive =
            isDraftRoadClosureChangeActive() &&
            !!(ext && ext.is_riyadh_road && ext.geometry) &&
            !!getVisualizationStyle(closureFeatureLabel());
        const rid = ext && (ext.riyadh_road_id != null ? ext.riyadh_road_id : ext.id);

        try {
            if (typeof window.setRiyadhTileSelectionSuppressedForOverlay === 'function') {
                window.setRiyadhTileSelectionSuppressedForOverlay(draftActive);
            }
        } catch (eSel) {}

        try {
            if (typeof window.setRiyadhRoadBasemapHiddenForClosureOverlay === 'function') {
                if (draftActive && rid != null) {
                    window.setRiyadhRoadBasemapHiddenForClosureOverlay(rid, true);
                } else {
                    window.setRiyadhRoadBasemapHiddenForClosureOverlay(null, false);
                }
            }
        } catch (eBase) {}
    }

    function applyRoadClosureDraftAndInitialFromRaw(raw) {
        if (raw === undefined || raw === null) {
            return;
        }
        const closed = window.parseRoadClosurePayloadValue(raw);
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
        const closed = window.parseRoadClosurePayloadValue(roadClosureRaw);
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
        if (window.__riyadhRoadSuppressMapPaint) {
            syncDraftClosureMapLayers();
            return;
        }
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
        if (ext && ext.is_riyadh_road) {
            try {
                const geom = getGeometryForRiyadhVisualization(ext);
                const rid = ext.riyadh_road_id != null ? ext.riyadh_road_id : ext.id;
                if (rid != null && geom) {
                    const draftClosureOverlay = isDraftRoadClosureChangeActive();
                    if (draftClosureOverlay) {
                        setSelectedOverlayGeometry(geom);
                        updateRiyadhRoadVisualization(rid, lbl, geom);
                    } else {
                        setSelectedOverlayGeometry(null);
                        hideSelectedOverlayPaint();
                        updateRiyadhRoadVisualization(rid, lbl, null);
                    }
                    updateLineVisualizationFromGeometry(geom, lbl);
                    updated = true;
                }
            } catch (e2) {}
        }

        if (updated) {
            try {
                updateFeatureTypeVisualization();
            } catch (e3) {}
        }
        syncDraftClosureMapLayers();
        tryRefreshRoadShapeLegendSwatch();
    }

    function tryRefreshRoadShapeLegendSwatch() {
        try {
            if (typeof window.refreshRoadShapeLegendSwatch === 'function') {
                window.refreshRoadShapeLegendSwatch();
            }
        } catch (e) {}
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

    /**
     * SVG previews: feature symbology only (color / width / dash).
     * Cyan selection casing is map interaction state - never part of the preview.
     */
    function appendSvgFeatureSymbologyPath(svg, pathData, style, svgDasharray, strokeScale) {
        if (!svg || !pathData || !style) {
            return;
        }
        const sc = Number(strokeScale) > 0 ? Number(strokeScale) : 0.42;
        const lw = Number(style.lineWidth) || 4;
        const coreW = Math.max(1.5, lw * sc);
        const dashed = hasDashGap(getEffectiveDashArray(style));
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', pathData);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', style.lineColor || '#64748b');
        p.setAttribute('stroke-width', String(coreW));
        p.setAttribute('stroke-opacity', '1');
        p.setAttribute('stroke-linecap', dashed ? 'butt' : 'round');
        p.setAttribute('stroke-linejoin', dashed ? 'miter' : 'round');
        if (svgDasharray) {
            p.setAttribute('stroke-dasharray', svgDasharray);
        }
        svg.appendChild(p);
    }

    function projectPreviewCoordsToSvgPoints(coordinates, minX, minY, scale, offsetX, offsetY, height) {
        return coordinates.map(function (coord) {
            return {
                x: (coord[0] - minX) * scale + offsetX,
                y: height - ((coord[1] - minY) * scale + offsetY),
            };
        });
    }

    function samplePointsAlongSvgPolyline(points, spacing) {
        const out = [];
        if (!points || points.length < 2) {
            return out;
        }
        const gap = Math.max(18, Number(spacing) || 42);
        const segLens = [];
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            segLens.push(len);
            total += len;
        }
        if (total < 1) {
            out.push({ x: points[0].x, y: points[0].y });
            return out;
        }
        const count = Math.max(2, Math.min(8, Math.round(total / gap)));
        for (let n = 0; n < count; n++) {
            const target = ((n + 0.5) / count) * total;
            let walked = 0;
            for (let i = 0; i < segLens.length; i++) {
                const segLen = segLens[i];
                if (walked + segLen >= target || i === segLens.length - 1) {
                    const t = segLen > 0 ? Math.min(1, Math.max(0, (target - walked) / segLen)) : 0;
                    const a = points[i];
                    const b = points[i + 1];
                    out.push({
                        x: a.x + (b.x - a.x) * t,
                        y: a.y + (b.y - a.y) * t,
                    });
                    break;
                }
                walked += segLen;
            }
        }
        return out;
    }

    function appendClosureNoEntryIconsAtSvgPoints(svg, points, options) {
        if (!svg || !points || points.length < 2) {
            return;
        }
        const isLightbox = !!(options && options.lightbox);
        const spacing = isLightbox ? 78 : 40;
        const radius = isLightbox ? 11 : 6.5;
        samplePointsAlongSvgPolyline(points, spacing).forEach(function (pt) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(pt.x));
            circle.setAttribute('cy', String(pt.y));
            circle.setAttribute('r', String(radius));
            circle.setAttribute('fill', '#e60012');
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            const barW = radius * 1.55;
            const barH = radius * 0.38;
            bar.setAttribute('x', String(pt.x - barW / 2));
            bar.setAttribute('y', String(pt.y - barH / 2));
            bar.setAttribute('width', String(barW));
            bar.setAttribute('height', String(barH));
            bar.setAttribute('rx', '0.5');
            bar.setAttribute('fill', '#ffffff');
            g.appendChild(circle);
            g.appendChild(bar);
            svg.appendChild(g);
        });
    }

    function appendClosureNoEntryIconsToSvg(svg, coordinates, proj, options) {
        if (!svg || !coordinates || coordinates.length < 2 || !proj) {
            return;
        }
        appendClosureNoEntryIconsAtSvgPoints(
            svg,
            projectPreviewCoordsToSvgPoints(
                coordinates,
                proj.minX,
                proj.minY,
                proj.scale,
                proj.offsetX,
                proj.offsetY,
                proj.height
            ),
            options
        );
    }

    function renderPreviewPlaceholder(container, message) {
        if (!container) {
            return;
        }
        const text =
            message || uiT('symbology_loading_style', 'Loading style…');
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

    /**
     * Road geometry for MVT/overlay while editing: prefer in-memory snapshot, else GeoJSON on
     * #editFeatureScreen (e.g. before geometry is re-attached to approvedLineBeingEdited).
     */
    function getGeometryForRiyadhVisualization(external) {
        if (external && external.geometry) {
            return external.geometry;
        }
        const g = getBestAvailableSelectedGeometry();
        if (g) {
            return g;
        }
        try {
            const es = document.getElementById('editFeatureScreen');
            if (!es) {
                return null;
            }
            const raw = es.getAttribute('data-request-geometry');
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return normalizeToLineStringGeometry(parsed) || parsed;
        } catch (eG) {
            return null;
        }
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
                if (typeof window.__paintRoadClosureToggle === 'function') {
                    try {
                        window.__paintRoadClosureToggle();
                    } catch (eRc) {}
                }
            };

            sidePanel = document.getElementById('editSidePanel');
            sidePanelContent = document.getElementById('sidePanelContent');

            initMapSidePanelChrome();

            setupRiyadhGeometryEditToolbarOnce();

            setupLineDrawingListeners();
            setupFeatureSearch();
            startHidingDefaultRendering();

            try {
                if (!window.__geotrakSymbologyLineDrawingCatalogSync) {
                    window.__geotrakSymbologyLineDrawingCatalogSync = true;
                    window.addEventListener('symbology:catalogLoaded', function () {
                        try {
                            if (document.getElementById('lineDropdownsContainer')) {
                                populateDropdowns();
                            }
                        } catch (eDrop) {}
                        try {
                            if (window.currentRoadClosureState) {
                                refreshSymbologyAfterRoadClosureChange();
                            }
                        } catch (eRc) {}
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
        if (!drawInstance || lineDrawingListenersBound) {
            return;
        }
        lineDrawingListenersBound = true;

        drawInstance.on('finish', function(id) {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });
            if (feature && feature.geometry && feature.geometry.type === 'LineString') {
                stopDrawingMonitor();
                handleLineDrawn(id);
            }
        });

        if (drawingDetectInterval) {
            clearInterval(drawingDetectInterval);
        }
        drawingDetectInterval = setInterval(syncInProgressDrawingMonitor, 100);

        drawInstance.on('select', function(id) {
            handleFeatureSelected(id);
        });

        drawInstance.on('deselect', function() {
            handleFeatureDeselected();
        });
    }

    function syncInProgressDrawingMonitor() {
        if (!drawInstance) {
            return;
        }

        try {
            if (drawInstance.getMode() !== 'linestring') {
                stopDrawingMonitor();
                return;
            }

            const snapshot = drawInstance.getSnapshot() || [];
            const lineFeatures = snapshot.filter(function(f) {
                return f && f.geometry && f.geometry.type === 'LineString';
            });

            if (!lineFeatures.length) {
                stopDrawingMonitor();
                return;
            }

            const lineId = lineFeatures[lineFeatures.length - 1].id;
            if (drawingLineId !== lineId) {
                drawingLineId = lineId;
                currentLineId = lineId;
                startDrawingMonitor();
            }
        } catch (e) {}
    }

    function hideDefaultRendering() {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        try {
            const mapContainer = map.getContainer();
            if (!mapContainer) {
                return;
            }

            mapContainer.querySelectorAll('svg').forEach(function(svg) {
                svg.querySelectorAll('path').forEach(function(path) {
                    const pathData = path.getAttribute('d') || '';
                    if (
                        pathData &&
                        (pathData.indexOf('L') !== -1 ||
                            pathData.indexOf('M') !== -1 ||
                            pathData.indexOf('l') !== -1 ||
                            pathData.indexOf('m') !== -1 ||
                            pathData.indexOf('Z') !== -1 ||
                            pathData.indexOf('z') !== -1)
                    ) {
                        path.style.setProperty('display', 'none', 'important');
                        path.style.setProperty('visibility', 'hidden', 'important');
                        path.style.setProperty('opacity', '0', 'important');
                        path.setAttribute('display', 'none');
                    }
                });

                svg.querySelectorAll('line').forEach(function(line) {
                    line.style.setProperty('display', 'none', 'important');
                    line.style.setProperty('visibility', 'hidden', 'important');
                    line.style.setProperty('opacity', '0', 'important');
                    line.setAttribute('display', 'none');
                });
            });
        } catch (e) {}
    }

    function setupSVGObserver() {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        try {
            const mapContainer = map.getContainer();
            if (!mapContainer) {
                return;
            }

            if (svgObserver) {
                svgObserver.disconnect();
            }

            svgObserver = new MutationObserver(function() {
                hideDefaultRendering();
            });

            svgObserver.observe(mapContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['d', 'x1', 'y1', 'x2', 'y2', 'class']
            });
        } catch (e) {}
    }

    function startHidingDefaultRendering() {
        if (typeof map === 'undefined' || !map || hideDefaultRenderingStarted) {
            return;
        }
        hideDefaultRenderingStarted = true;

        hideDefaultRendering();
        setupSVGObserver();
        map.on('render', hideDefaultRendering);
    }

    function startDrawingMonitor() {
        if (drawingMonitorInterval) {
            clearInterval(drawingMonitorInterval);
        }

        drawingMonitorInterval = setInterval(function() {
            if (!drawInstance || !drawingLineId) {
                stopDrawingMonitor();
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
                    stopDrawingMonitor();
                }
            } catch (e) {}
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
        if (!drawInstance) {
            return;
        }

        try {
            stopDrawingMonitor();

            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });
            if (!feature || !feature.geometry || feature.geometry.type !== 'LineString') {
                return;
            }

            currentLineId = id;
            selectedLineId = id;
            hideDefaultRendering();
            renderLineAsMapLibreLayer(id);

            setTimeout(function() {
                if (drawInstance) {
                    try {
                        drawInstance.setMode('select');
                    } catch (e) {}
                }

                hideDefaultRendering();
                showLineSidePanel();
                updateCurrentFeatureLabel('Line');
                setMapContainerDrawnLineSelectionAttr(id);
                updateLineVisualization();

                if (typeof window.setCurrentRoadClosure === 'function') {
                    window.setCurrentRoadClosure(false);
                }
            }, 100);
        } catch (error) {}
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

            const renderGeneration = draftLineMapLayerGeneration;
            setTimeout(function() {
                if (renderGeneration !== draftLineMapLayerGeneration) {
                    return;
                }
                hideDefaultRendering();
                renderLineAsMapLibreLayer(id, { renderGeneration: renderGeneration });
            }, 100);
        } catch (error) {
            selectedLineId = id;
            currentLineId = id;
            
            if (!currentFeatureLabel) {
                updateCurrentFeatureLabel('Line');
            }
            
            setMapContainerDrawnLineSelectionAttr(id);
        }
    }

    function setMapContainerDrawnLineSelectionAttr(id) {
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            if (id == null || id === '') {
                mapContainer.removeAttribute('data-selected-line');
            } else {
                mapContainer.setAttribute('data-selected-line', String(id));
            }
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
            syncDraftClosureMapLayers();
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

        // Open the side panel with a consistent rendering path.
        showLineSidePanel();

        // Ensure the default feature label is visible for new drawn lines.
        updateCurrentFeatureLabel('Line');

        // Defensive: allow MapLibre style updates to settle.
        setTimeout(function() {
            hideDefaultRendering();
        }, 50);
        notifyMapSelectionChanged();
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
        notifyMapSelectionCleared();
    }

    function clearMapRoadSelection() {
        if (typeof window.roadGeometryEdit !== 'undefined' && window.roadGeometryEdit.stop) {
            window.roadGeometryEdit.stop();
        }
        // Don't wipe manager Approve/Reject UI while a bell-queue review is open.
        if (
            !window.managerApprovalReviewActive &&
            typeof window.clearApprovalRequestMapOverlay === 'function'
        ) {
            window.clearApprovalRequestMapOverlay();
        }

        const roadCtx = window.selectedRiyadhRoad || window.approvedLineBeingEdited || null;
        const shared = riyadhShared();
        const roadId =
            roadCtx && roadCtx.is_riyadh_road && shared
                ? shared.getRiyadhRoadNetworkId(roadCtx)
                : null;
        const hadRiyadhContext = !!roadCtx;

        if (typeof window.setRiyadhRoadSelectedId === 'function') {
            window.setRiyadhRoadSelectedId(null);
        }
        if (roadId != null && typeof window.clearRiyadhRoadDbFclassFromDatabase === 'function') {
            try {
                window.clearRiyadhRoadDbFclassFromDatabase(roadId);
            } catch (eFclass) {}
        }
        if (roadId != null && typeof window.clearRiyadhRoadDbClosureFromDatabase === 'function') {
            try {
                window.clearRiyadhRoadDbClosureFromDatabase(roadId);
            } catch (eClosure) {}
        }
        if (typeof window.syncRiyadhTileSelectionCoreForFeatureLabel === 'function') {
            try {
                window.syncRiyadhTileSelectionCoreForFeatureLabel(null);
            } catch (eCoreLbl) {}
        }

        window.selectedRiyadhRoad = null;
        window.approvedLineBeingEdited = null;

        try {
            setSelectedOverlayGeometry(null);
            hideSelectedOverlayPaint();
            syncDraftClosureMapLayers();
            if (typeof window.restoreRiyadhRoadNetworkVisibility === 'function') {
                window.restoreRiyadhRoadNetworkVisibility();
            }
        } catch (eOverlay) {}

        if (hadRiyadhContext && typeof window.setCurrentRoadClosure === 'function') {
            window.setCurrentRoadClosure(false);
        }

        if (selectedLineId) {
            removeMapLibreLineLayer(selectedLineId);
        }
        selectedLineId = null;
        currentLineId = null;

        if (window.currentlySelectedItemType === 'terradraw-line') {
            window.currentlySelectedItem = null;
            window.currentlySelectedItemType = null;
        }

        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.removeAttribute('data-selected-line');
        }

        if (drawInstance) {
            try {
                const mode = drawInstance.getMode();
                if (mode === 'select') {
                    drawInstance.setMode('static');
                    drawInstance.setMode('select');
                }
            } catch (eDraw) {}
        }

        const editScreen = document.getElementById('editFeatureScreen');
        if (editScreen) {
            editScreen.remove();
            showSidePanelDefaultElements();
        }

        if (typeof window.isMapEditModeActive === 'function' && window.isMapEditModeActive()) {
            showLineSidePanel();
        } else {
            applyMapSidePanelOpen(false);
        }

        notifyMapSelectionCleared();
    }

    function hasMapRoadSelection() {
        return !!(
            window.selectedRiyadhRoad ||
            (window.approvedLineBeingEdited && window.approvedLineBeingEdited.is_riyadh_road) ||
            selectedLineId ||
            currentLineId ||
            document.getElementById('editFeatureScreen') ||
            (window.viewingRequestIds && window.viewingRequestIds.length)
        );
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
        hideRiyadhGeometryEditToolbar();

        showSidePanelDefaultElements();

        const searchResults = document.getElementById('featureSearchResults');
        if (searchResults) {
            searchResults.style.display = 'block';
            searchResults.innerHTML = '<p class="msp-empty">' + uiT('feature_search_hint', 'Type to search feature types (e.g. Motorway, Path, Fence).') + '</p>';
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
                    const dropdownBox = createDropdownBox(label);
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

            // Drawn line preview (TerraDraw) - will no-op if no line is selected.
            updateLineVisualization();

            // If nothing is selected, show a placeholder instead of an empty card.
            if (!currentLineId) {
                const svgContainer = document.getElementById('lineVisualizationSVG');
                if (svgContainer) {
                    renderPreviewPlaceholder(
                        svgContainer,
                        uiT('symbology_select_line', 'Select a line to preview')
                    );
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
            'map-line-symbology-preview mb-4 rounded-xl border border-geotrak-border bg-white p-3 shadow-sm';
        container.style.display = 'block'; // Ensure container is visible

        const labelText = document.createElement('div');
        labelText.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1.5';
        labelText.textContent = uiT('current_feature', 'Current feature');
        container.appendChild(labelText);

        const valueDisplay = document.createElement('div');
        valueDisplay.id = 'lineVisualizationFeatureName';
        valueDisplay.className = 'text-sm font-semibold text-geotrak mb-2';
        // Use current feature label instead of hardcoding 'Line'
        valueDisplay.textContent = displayFeatureTypeLabel(currentFeatureLabel || 'Line');
        container.appendChild(valueDisplay);

        const svgContainer = document.createElement('div');
        svgContainer.id = 'lineVisualizationSVG';
        svgContainer.className =
            'relative w-full overflow-hidden rounded-lg border border-geotrak-border bg-geotrak-subtle';
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
            renderPreviewPlaceholder(
                svgContainer,
                uiT('symbology_no_preview', 'No preview available')
            );
            return;
        }

        try {
            const coordinates = normalizedGeometry.coordinates;
            if (!coordinates || coordinates.length < 2) {
                renderPreviewPlaceholder(
                    svgContainer,
                    uiT('symbology_no_preview', 'No preview available')
                );
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
                renderPreviewPlaceholder(
                    svgContainer,
                    uiT('symbology_loading', 'Loading symbology…')
                );
                rerenderOnCatalogLoaded(function() {
                    updateLineVisualizationFromGeometry(geometry, featureLabel);
                });
                return;
            }
            const svgDasharray = dasharrayToSvg(style);
            appendSvgFeatureSymbologyPath(svg, pathData, style, svgDasharray, 0.42);
            if (isRoadClosedForCurrentContext()) {
                const svgPoints = coordinates.map(function (coord) {
                    return {
                        x: coord[0] * scale + offsetX,
                        y: -coord[1] * scale + offsetY,
                    };
                });
                appendClosureNoEntryIconsAtSvgPoints(svg, svgPoints);
            }

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
                renderPreviewPlaceholder(
                    svgContainer,
                    uiT('symbology_loading', 'Loading symbology…')
                );
                rerenderOnCatalogLoaded(function() {
                    updateLineVisualization();
                });
                return;
            }
            const svgDasharray = dasharrayToSvg(style);
            appendSvgFeatureSymbologyPath(svg, pathData, style, svgDasharray, 1);
            if (isRoadClosedForCurrentContext()) {
                const svgPoints = coordinates.map(function (coord) {
                    return {
                        x: coord[0] * scale + offsetX,
                        y: -coord[1] * scale + offsetY,
                    };
                });
                appendClosureNoEntryIconsAtSvgPoints(svg, svgPoints);
            }

            svgContainer.innerHTML = '';
            svgContainer.appendChild(svg);

        } catch (e) {
        }
    }

    function updateCurrentFeatureLabel(featureType) {
        featureType = featureType || "Line";
        currentFeatureLabel = featureType;

        const valueDisplay = document.getElementById("currentFeatureValue");
        if (valueDisplay) valueDisplay.textContent = displayFeatureTypeLabel(currentFeatureLabel);

        const visualizationFeatureName = document.getElementById("lineVisualizationFeatureName");
        if (visualizationFeatureName) visualizationFeatureName.textContent = displayFeatureTypeLabel(currentFeatureLabel);

        const selectedFeatureName = document.getElementById("selectedFeatureName");
        if (selectedFeatureName) selectedFeatureName.textContent = displayFeatureTypeLabel(currentFeatureLabel);

        if (currentLineId) {
            renderLineAsMapLibreLayer(currentLineId);
        }

        const external = getCurrentExternalEditingFeature();
        try {
            if (external && external.geometry) {
                updateLineVisualizationFromGeometry(external.geometry, currentFeatureLabel);
            } else {
                updateLineVisualization();
            }
        } catch (e) {
        }

        try {
            if (external && external.is_riyadh_road) {
                if (!external._original_feature_label) {
                    external._original_feature_label = external.current_feature_label || external.feature_type || currentFeatureLabel;
                }
                external.current_feature_label = currentFeatureLabel;
                external.feature_type = currentFeatureLabel;
                syncRiyadhRoadsFieldsDataFclassFromFeatureLabel(currentFeatureLabel);
                const roadId = external.riyadh_road_id != null ? external.riyadh_road_id : external.id;
                const vizGeom = getGeometryForRiyadhVisualization(external);
                if (roadId != null) {
                    ensureSymbologyCatalogRequested();
                    updateRiyadhRoadVisualization(roadId, currentFeatureLabel, vizGeom);
                    if (vizGeom) {
                        setSelectedOverlayGeometry(vizGeom);
                    }
                }
            }
        } catch (e) {
        }

        updateFeatureTypeVisualization();
        updateFeatureTypeLabelDisplay();
        tryRefreshRoadShapeLegendSwatch();
    }

    function getCurrentFeatureLabel() {
        return currentFeatureLabel || 'Line';
    }

    function renderLineAsMapLibreLayer(id, renderOptions) {
        if (typeof map === 'undefined' || !map || !drawInstance) return;

        const opts = renderOptions || {};
        const renderGeneration =
            opts.renderGeneration != null ? opts.renderGeneration : draftLineMapLayerGeneration;
        if (renderGeneration !== draftLineMapLayerGeneration) {
            return;
        }

        const deferredOpts = { renderGeneration: renderGeneration };
        
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
                    renderLineAsMapLibreLayer(id, deferredOpts);
                });
                map.once('style.load', function() {
                    renderLineAsMapLibreLayer(id, deferredOpts);
                });
                return;
            }
            
            const style = getEffectiveVisualizationStyle(currentFeatureLabel);
            if (!style) {
                rerenderOnCatalogLoaded(function () {
                    renderLineAsMapLibreLayer(id, deferredOpts);
                });
                return;
            }
            const mls = mapLineSelection();
            const lineDasharray = getEffectiveDashArray(style);
            const casingOpts = getCasingOptionsForDash(lineDasharray);
            const drawnLineLayout = {
                'line-join': 'round',
                'line-cap': hasDashGap(lineDasharray) ? 'butt' : 'round',
            };

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

                    mls.applyGeoJsonCasingFromCoreWidth(map, outlineLayerId, ringLayerId, style.lineWidth, lineDasharray, casingOpts);
                    mls.applyLinePaint(map, layerId, mls.buildEditingCorePaint(style, lineDasharray, currentFeatureLabel));
                    [outlineLayerId, ringLayerId, layerId].forEach(function (lid) {
                        if (map.getLayer(lid)) {
                            try {
                                map.setLayoutProperty(lid, 'line-join', drawnLineLayout['line-join']);
                                map.setLayoutProperty(lid, 'line-cap', drawnLineLayout['line-cap']);
                            } catch (eLay) {}
                        }
                    });

                    registerDrawnLineLayer(id, sourceId, layerId, outlineLayerId, ringLayerId);
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
            
            const pair = mls.maplibreSelectionCasingPaintPair(style.lineWidth, lineDasharray, casingOpts);
            map.addLayer({
                id: outlineLayerId,
                type: 'line',
                source: sourceId,
                layout: drawnLineLayout,
                paint: pair.outline,
            });
            map.addLayer({
                id: ringLayerId,
                type: 'line',
                source: sourceId,
                layout: drawnLineLayout,
                paint: pair.ring,
            });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: drawnLineLayout,
                paint: mls.buildEditingCorePaint(style, lineDasharray, currentFeatureLabel),
            });
            
            registerDrawnLineLayer(id, sourceId, layerId, outlineLayerId, ringLayerId);
            
            hideDefaultRendering();
            
        } catch (e) {
            setTimeout(function() {
                renderLineAsMapLibreLayer(id, deferredOpts);
            }, 100);
        }
    }

    function refreshAfterUndoRedo() {
        if (typeof map === 'undefined' || !map || !drawInstance) {
            return;
        }

        try {
            const snapshot = drawInstance.getSnapshot() || [];
            const lineFeatures = snapshot.filter(function(feature) {
                return !!(feature && feature.geometry && feature.geometry.type === 'LineString');
            });

            const activeIds = new Set(lineFeatures.map(function(feature) {
                return feature.id;
            }));

            if (map._drawnLineLayers) {
                Object.keys(map._drawnLineLayers).forEach(function(id) {
                    if (!activeIds.has(id)) {
                        removeMapLibreLineLayer(id);
                        if (currentLineId === id) {
                            currentLineId = null;
                        }
                    }
                });
            }

            lineFeatures.forEach(function(feature) {
                renderLineAsMapLibreLayer(feature.id);
            });

            if (currentLineId && !activeIds.has(currentLineId)) {
                currentLineId = lineFeatures.length ? lineFeatures[lineFeatures.length - 1].id : null;
            } else if (!currentLineId && lineFeatures.length) {
                currentLineId = lineFeatures[lineFeatures.length - 1].id;
            }

            selectedLineId = currentLineId;

            if (currentLineId) {
                setMapContainerDrawnLineSelectionAttr(currentLineId);
                try {
                    updateLineVisualization();
                } catch (eViz) {}
                try {
                    updateFeatureTypeVisualization();
                } catch (eFeat) {}
            } else {
                setMapContainerDrawnLineSelectionAttr(null);
                const svgContainer = document.getElementById('lineVisualizationSVG');
                if (svgContainer) {
                    svgContainer.innerHTML = '';
                }
                const featureViz = document.getElementById('featureTypeVisualization');
                if (featureViz) {
                    featureViz.innerHTML = '';
                }
            }

            // Keep MapLibre draft preview attached after in-progress draw undo/redo.
            syncInProgressDrawingMonitor();
            hideDefaultRendering();
        } catch (e) {}
    }

    function registerDrawnLineLayer(id, sourceId, layerId, outlineLayerId, ringLayerId) {
        if (!map || id == null || id === '') {
            return;
        }
        if (!map._drawnLineLayers) {
            map._drawnLineLayers = {};
        }
        map._drawnLineLayers[String(id)] = {
            sourceId: sourceId,
            layerId: layerId,
            outlineLayerId: outlineLayerId,
            ringLayerId: ringLayerId,
        };
    }

    function removeDrawnLineLayerEntry(entry) {
        if (!entry || typeof map === 'undefined' || !map) {
            return;
        }
        try {
            if (entry.layerId && map.getLayer(entry.layerId)) {
                map.removeLayer(entry.layerId);
            }
            if (entry.ringLayerId && map.getLayer(entry.ringLayerId)) {
                map.removeLayer(entry.ringLayerId);
            }
            if (entry.outlineLayerId && map.getLayer(entry.outlineLayerId)) {
                map.removeLayer(entry.outlineLayerId);
            }
            if (entry.sourceId && map.getSource(entry.sourceId)) {
                map.removeSource(entry.sourceId);
            }
        } catch (e) {}
    }

    function removeMapLibreLineLayer(id) {
        if (typeof map === 'undefined' || !map || id == null || id === '') {
            return;
        }

        const idStr = String(id);
        const registry = map._drawnLineLayers || {};
        const entry = registry[idStr];

        if (entry) {
            removeDrawnLineLayerEntry(entry);
            delete registry[idStr];
            return;
        }

        removeDrawnLineLayerEntry({
            sourceId: 'drawn-line-' + idStr,
            layerId: 'drawn-line-layer-' + idStr,
            outlineLayerId: 'drawn-line-outline-' + idStr,
            ringLayerId: 'drawn-line-ring-' + idStr,
        });
    }

    function clearAllDrawnLineMapLibreLayers() {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        const registry = map._drawnLineLayers || {};
        const seen = new Set();
        Object.keys(registry).forEach(function (key) {
            const entry = registry[key];
            if (!entry || seen.has(entry.sourceId)) {
                return;
            }
            seen.add(entry.sourceId);
            removeDrawnLineLayerEntry(entry);
        });

        try {
            const style = typeof map.getStyle === 'function' ? map.getStyle() : null;
            if (style && style.layers) {
                style.layers.slice().forEach(function (layer) {
                    if (!layer || !layer.id) {
                        return;
                    }
                    if (
                        layer.id.indexOf('drawn-line-layer-') === 0 ||
                        layer.id.indexOf('drawn-line-outline-') === 0 ||
                        layer.id.indexOf('drawn-line-ring-') === 0
                    ) {
                        try {
                            if (map.getLayer(layer.id)) {
                                map.removeLayer(layer.id);
                            }
                        } catch (eLayer) {}
                    }
                });
            }
            if (style && style.sources) {
                Object.keys(style.sources).forEach(function (sourceId) {
                    if (sourceId.indexOf('drawn-line-') !== 0) {
                        return;
                    }
                    if (
                        sourceId.indexOf('drawn-line-layer-') === 0 ||
                        sourceId.indexOf('drawn-line-outline-') === 0 ||
                        sourceId.indexOf('drawn-line-ring-') === 0
                    ) {
                        return;
                    }
                    try {
                        if (map.getSource(sourceId)) {
                            map.removeSource(sourceId);
                        }
                    } catch (eSource) {}
                });
            }
        } catch (eSweep) {}

        map._drawnLineLayers = {};
    }

    function clearTerraDrawFeatures() {
        if (!drawInstance || typeof drawInstance.clear !== 'function') {
            return;
        }
        try {
            drawInstance.clear();
        } catch (eDraw) {}
    }

    function clearDraftLineDrawingFromMap() {
        draftLineMapLayerGeneration++;
        stopDrawingMonitor();
        clearAllDrawnLineMapLibreLayers();
        clearTerraDrawFeatures();

        selectedLineId = null;
        currentLineId = null;

        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.removeAttribute('data-selected-line');
        }

        if (window.currentlySelectedItemType === 'terradraw-line') {
            window.currentlySelectedItem = null;
            window.currentlySelectedItemType = null;
        }

        // Keep post-save GeoJSON overlay until fresh MVT tiles settle.
        if (window.__riyadhPostSaveOverlayActive) {
            try {
                syncDraftClosureMapLayers();
            } catch (eKeep) {}
            return;
        }

        try {
            setSelectedOverlayGeometry(null);
            hideSelectedOverlayPaint();
            if (typeof window.setRiyadhRoadSelectedId === 'function') {
                window.setRiyadhRoadSelectedId(null);
            }
            if (typeof window.syncRiyadhTileSelectionCoreForFeatureLabel === 'function') {
                window.syncRiyadhTileSelectionCoreForFeatureLabel(null);
            }
            syncDraftClosureMapLayers();
        } catch (eClear) {}
    }

    function createDropdownBox(label) {
        const container = document.createElement('div');
        container.className = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full bg-white hover:bg-geotrak-subtle border border-geotrak-border rounded-lg px-4 py-3 text-left text-geotrak shadow-sm transition-colors duration-200 flex items-center justify-between group';
        button.setAttribute('data-dropdown-toggle', 'dropdown-' + label.replace(/\s+/g, '-').toLowerCase());

        const icon = createIconForLabel(label);
        
        const buttonContent = document.createElement('div');
        buttonContent.className = 'flex items-center gap-3 flex-1';
        buttonContent.appendChild(icon);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium flex-1';
        labelSpan.textContent = displayFeatureCategoryLabel(label);
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
        dropdownMenu.className = 'hidden absolute z-50 w-full mt-1 bg-white border border-geotrak-border rounded-lg shadow-lg max-h-60 overflow-y-auto';
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
        button.className = 'w-full bg-white hover:bg-geotrak-subtle border border-geotrak-border rounded-lg px-4 py-3 text-left text-geotrak shadow-sm transition-colors duration-200 flex items-center justify-between group';
        button.setAttribute('data-line-box', 'true');

        const iconContainer = document.createElement('div');
        iconContainer.className = 'flex-shrink-0 w-6 h-6 flex items-center justify-center';

        const folderContainer = document.createElement('div');
        folderContainer.className = 'w-5 h-5 rounded flex items-center justify-center bg-geotrak-muted';

        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('class', 'w-4 h-4');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'none');
        iconSvg.setAttribute('stroke', '#5a6f8c');
        iconSvg.setAttribute('stroke-width', '2');
        iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M6 8v8M12 8v8M18 8v8"></path>';
        folderContainer.appendChild(iconSvg);
        iconContainer.appendChild(folderContainer);

        const buttonContent = document.createElement('div');
        buttonContent.className = 'flex items-center gap-3 flex-1';
        buttonContent.appendChild(iconContainer);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium flex-1';
        labelSpan.textContent = uiT('tool_road', 'Road');
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

    function updateDropdownButtonText(dropdownLabel) {
        const dropdownsContainer = document.getElementById('lineDropdownsContainer');
        if (!dropdownsContainer) return;

        const dropdowns = dropdownsContainer.querySelectorAll('[data-dropdown-toggle]');
        dropdowns.forEach(function(dropdownButton) {
            const menuId = dropdownButton.getAttribute('data-dropdown-toggle');
            const menu = document.getElementById(menuId);
            if (menu && menu.getAttribute('data-dropdown-label') === dropdownLabel) {
                const labelSpan = dropdownButton.querySelector('span');
                if (labelSpan) {
                    labelSpan.textContent = displayFeatureCategoryLabel(dropdownLabel);
                }
            }
        });
    }

    function isRoadPanelViewOnly() {
        if (!document.getElementById('editFeatureScreen')) {
            return false;
        }
        // Manager approval review is always read-only in the side panel.
        if (window.managerApprovalReviewActive) {
            return true;
        }
        return typeof window.isMapEditModeActive === 'function' && !window.isMapEditModeActive();
    }

    function requireMapEditModeForChange() {
        if (window.managerApprovalReviewActive) {
            return false;
        }
        if (!isRoadPanelViewOnly()) {
            return true;
        }
        if (typeof window.promptEnableEditMode === 'function') {
            window.promptEnableEditMode();
        }
        return false;
    }

    function bindRoadPanelEditGuards(editScreen) {
        if (!editScreen || editScreen.getAttribute('data-edit-guards-bound') === '1') {
            return;
        }

        editScreen.addEventListener('click', function(e) {
            if (!isRoadPanelViewOnly()) {
                return;
            }
            // Symbology enlarge is view-only safe - never gate behind Edit Mode.
            if (e.target.closest('.msp-hero__zoom, [data-symbology-zoom], .msp-lightbox, .msp-lightbox__close, .msp-lightbox__stage')) {
                return;
            }
            const interactive = e.target.closest('button, input, select, textarea');
            if (!interactive) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            requireMapEditModeForChange();
        }, true);

        editScreen.addEventListener('focusin', function(e) {
            if (!isRoadPanelViewOnly()) {
                return;
            }
            const target = e.target;
            if (!target || !target.matches('input, textarea, select')) {
                return;
            }
            e.preventDefault();
            target.blur();
            requireMapEditModeForChange();
        }, true);

        editScreen.setAttribute('data-edit-guards-bound', '1');
    }

    function syncRoadPanelEditModeUI() {
        const editScreen = document.getElementById('editFeatureScreen');
        if (!editScreen) {
            return;
        }

        const viewOnly = isRoadPanelViewOnly();
        editScreen.setAttribute('data-view-only', viewOnly ? 'true' : 'false');

        const changeBtn = editScreen.querySelector('[data-feature-type-change]');
        if (changeBtn) {
            changeBtn.hidden = viewOnly;
        }

        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.syncPendingBanner === 'function'
        ) {
            window.PendingRoadLocks.syncPendingBanner();
        }

        syncRoadLabelFieldUI();

        const closed = !!window.currentRoadClosureState;
        const closureField = editScreen.querySelector('[data-road-closure-field]');
        if (closureField) {
            closureField.hidden = viewOnly;
        }
        const closureControl = editScreen.querySelector('[data-road-closure-control]');
        if (closureControl) {
            closureControl.classList.toggle('is-disabled', viewOnly);
            closureControl.querySelectorAll('button').forEach(function (btn) {
                btn.disabled = viewOnly;
            });
        }
        const closureSentence = editScreen.querySelector('[data-road-closure-sentence]');
        if (closureSentence) {
            closureSentence.hidden = !viewOnly;
            closureSentence.textContent = closed
                ? uiT('road_selected_closed', 'The road you selected is closed.')
                : uiT('road_selected_open', 'The road you selected is open.');
            closureSentence.classList.toggle('is-closed', closed);
            closureSentence.classList.toggle('is-open', !closed);
        }

        const lineData = window.approvedLineBeingEdited || window.selectedRiyadhRoad;
        const deleteField = editScreen.querySelector('[data-road-delete-field]');
        if (deleteField) {
            const canDelete = !viewOnly && !!(lineData && lineData.is_riyadh_road);
            deleteField.hidden = !canDelete;
        }
        syncRiyadhGeometryEditToolbar(editScreen, lineData);
    }

    window.syncRoadPanelEditModeUI = syncRoadPanelEditModeUI;

    function showEditFeatureScreen(options) {
        options = options || {};
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
        editScreen.className = 'msp-screen h-full flex flex-col min-h-0';

        if (requestGeometry) {
            editScreen.setAttribute('data-request-geometry', JSON.stringify(requestGeometry));
        }

        if (lineData) {
            editScreen.setAttribute('data-line-data', JSON.stringify(lineData));
        }

        const content = document.createElement('div');
        content.className = 'msp-scroll';
        content.appendChild(createRoadDetailsSheet());
        editScreen.appendChild(content);
        flexContainer.appendChild(editScreen);

        setupRiyadhGeometryEditToolbarOnce();
        bindRoadPanelEditGuards(editScreen);
        roadLabelFieldEditing = false;
        syncRoadPanelEditModeUI();

        updateFeatureTypeLabelDisplay();

        setTimeout(function() {
            applyEditScreenDataFromLineData(lineData);
            if (requestGeometry) {
                updateFeatureTypeVisualizationFromGeometry(requestGeometry);
            } else {
                updateFeatureTypeVisualization();
            }
            syncRoadPanelEditModeUI();
        }, 0);
    }

    function updateFeatureTypeLabelDisplay() {
        const labelToDisplay = getCurrentFeatureLabel();
        
        const selectedFeatureName = document.getElementById('selectedFeatureName');
        if (selectedFeatureName) {
            selectedFeatureName.textContent = displayFeatureTypeLabel(labelToDisplay);
        }
        
        const visualizationFeatureName = document.getElementById('lineVisualizationFeatureName');
        if (visualizationFeatureName) {
            visualizationFeatureName.textContent = displayFeatureTypeLabel(labelToDisplay);
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
        dropdowns.forEach(function(menu) {
            const items = menu.querySelectorAll('[role="menuitem"]');
            items.forEach(function(item) {
                if (item.textContent.trim() === currentFeatureLabel) {
                    const dropdownLabel = menu.getAttribute('data-dropdown-label');
                    if (dropdownLabel) {
                        updateDropdownButtonText(dropdownLabel);
                    }
                }
            });
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
                child.style.display = '';
            }
        });
    }

    function closeFeatureSymbologyLightbox() {
        const overlay = document.getElementById('mspSymbologyLightbox');
        if (overlay) {
            overlay.remove();
        }
        document.removeEventListener('keydown', onFeatureSymbologyLightboxKeydown);
    }

    function onFeatureSymbologyLightboxKeydown(event) {
        if (event.key === 'Escape') {
            closeFeatureSymbologyLightbox();
        }
    }

    function openFeatureSymbologyLightbox() {
        closeFeatureSymbologyLightbox();

        const overlay = document.createElement('div');
        overlay.id = 'mspSymbologyLightbox';
        overlay.className = 'msp-lightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', uiT('symbology_preview_aria', 'Feature symbology preview'));

        const stage = document.createElement('div');
        stage.className = 'msp-lightbox__stage';
        stage.id = 'mspSymbologyLightboxStage';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'msp-lightbox__close';
        closeBtn.setAttribute('aria-label', uiT('close_preview', 'Close preview'));
        closeBtn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeFeatureSymbologyLightbox();
        });

        overlay.appendChild(closeBtn);
        overlay.appendChild(stage);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closeFeatureSymbologyLightbox();
            }
        });

        document.body.appendChild(overlay);
        document.addEventListener('keydown', onFeatureSymbologyLightboxKeydown);

        const geometry = getBestAvailableSelectedGeometry();
        if (geometry) {
            const normalized = normalizeToLineStringGeometry(geometry);
            if (normalized && normalized.coordinates && normalized.coordinates.length >= 2) {
                renderFeatureTypeVisualization(stage, normalized.coordinates, {
                    lightbox: true,
                    width: 960,
                    height: 420,
                    padding: 40,
                    fit: 0.9,
                    scaleFactor: 1.45
                });
                return;
            }
        }
        const source = document.getElementById('featureTypeVisualization');
        if (source && source.firstChild) {
            const clone = source.firstChild.cloneNode(true);
            clone.setAttribute('width', '100%');
            clone.setAttribute('height', '100%');
            stage.appendChild(clone);
        }
    }

    function createRoadDetailsSheet() {
        const sheet = document.createElement('article');
        sheet.className = 'msp-sheet';

        const hero = document.createElement('header');
        hero.className = 'msp-hero';

        const heroTop = document.createElement('div');
        heroTop.className = 'msp-hero__top';

        const eyebrow = document.createElement('p');
        eyebrow.className = 'msp-eyebrow';
        eyebrow.textContent = uiT('selected_feature', 'Selected feature');

        const changeBtn = document.createElement('button');
        changeBtn.type = 'button';
        changeBtn.setAttribute('data-feature-type-change', '');
        changeBtn.className = 'msp-link-btn';
        changeBtn.textContent = uiT('change_type', 'Change type');
        changeBtn.hidden = isRoadPanelViewOnly();
        changeBtn.addEventListener('click', function() {
            if (!requireMapEditModeForChange()) {
                return;
            }
            updateSearchFeatureScreenSelection();
            showLineSidePanel();
        });

        heroTop.appendChild(eyebrow);
        heroTop.appendChild(changeBtn);
        hero.appendChild(heroTop);

        const previewWrap = document.createElement('div');
        previewWrap.className = 'msp-hero__preview-wrap';

        const visualizationContainer = document.createElement('div');
        visualizationContainer.id = 'featureTypeVisualization';
        visualizationContainer.className = 'map-feature-type-symbology-preview msp-hero__preview';
        visualizationContainer.style.width = '100%';
        visualizationContainer.style.height = '68px';
        visualizationContainer.setAttribute(
            'title',
            uiT('feature_type_preview_title', 'Feature type preview')
        );
        previewWrap.appendChild(visualizationContainer);

        const zoomBtn = document.createElement('button');
        zoomBtn.type = 'button';
        zoomBtn.className = 'msp-hero__zoom';
        zoomBtn.setAttribute('data-symbology-zoom', '1');
        zoomBtn.setAttribute('aria-label', uiT('view_larger_symbology', 'View larger symbology'));
        zoomBtn.title = uiT('enlarge', 'Enlarge');
        zoomBtn.innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16zM11 8v6M8 11h6"></path></svg>';
        zoomBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openFeatureSymbologyLightbox();
        });
        previewWrap.appendChild(zoomBtn);
        hero.appendChild(previewWrap);

        const selectedFeatureName = document.createElement('h2');
        selectedFeatureName.id = 'selectedFeatureName';
        selectedFeatureName.className = 'msp-hero__title';
        selectedFeatureName.textContent = displayFeatureTypeLabel(getCurrentFeatureLabel());
        hero.appendChild(selectedFeatureName);

        sheet.appendChild(hero);

        const form = document.createElement('div');
        form.className = 'msp-form';

        const labelBlock = document.createElement('div');
        labelBlock.className = 'msp-field';

        const labelRow = document.createElement('div');
        labelRow.className = 'msp-field__head';

        const labelSpan = document.createElement('label');
        labelSpan.className = 'msp-field__label';
        labelSpan.setAttribute('for', 'sidebar-feature-name-input');
        labelSpan.textContent = uiT('road_label', 'Road label');
        labelRow.appendChild(labelSpan);

        const roadLabelActionBtn = document.createElement('button');
        roadLabelActionBtn.type = 'button';
        roadLabelActionBtn.id = 'sidebar-road-label-action-btn';
        roadLabelActionBtn.className = 'msp-text-btn';
        roadLabelActionBtn.hidden = true;
        roadLabelActionBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!requireMapEditModeForChange()) {
                return;
            }
            if ((roadLabelActionBtn.getAttribute('data-action') || 'edit') === 'edit') {
                beginRoadLabelEditing();
                return;
            }
            clearRoadLabelField();
        });
        labelRow.appendChild(roadLabelActionBtn);
        labelBlock.appendChild(labelRow);

        const roadLabelInput = document.createElement('input');
        roadLabelInput.type = 'text';
        roadLabelInput.id = 'sidebar-feature-name-input';
        roadLabelInput.className = 'msp-input msp-input--readonly is-readonly';
        roadLabelInput.placeholder = uiT('enter_road_name', 'Enter road name');
        roadLabelInput.autocomplete = 'off';
        roadLabelInput.readOnly = true;
        roadLabelInput.addEventListener('input', function () {
            syncRiyadhRoadFieldsDataName(roadLabelInput.value || '');
        });
        roadLabelInput.addEventListener('click', function () {
            if (isRoadPanelViewOnly() || roadLabelFieldEditing) {
                return;
            }
            beginRoadLabelEditing();
        });
        labelBlock.appendChild(roadLabelInput);
        form.appendChild(labelBlock);

        const closureSentence = document.createElement('p');
        closureSentence.className = 'msp-closure-sentence is-open';
        closureSentence.setAttribute('data-road-closure-sentence', '');
        closureSentence.textContent = uiT('road_selected_open', 'The road you selected is open.');
        form.appendChild(closureSentence);

        const closureBlock = document.createElement('div');
        closureBlock.className = 'msp-field';
        closureBlock.setAttribute('data-road-closure-field', '');

        const closureLabel = document.createElement('div');
        closureLabel.className = 'msp-field__label';
        closureLabel.textContent = uiT('road_closure', 'Road closure');
        closureBlock.appendChild(closureLabel);

        const segment = document.createElement('div');
        segment.className = 'msp-segment';
        segment.setAttribute('data-road-closure-control', '');
        segment.setAttribute('role', 'group');
        segment.setAttribute('aria-label', uiT('road_closure', 'Road closure'));

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'msp-segment__btn is-active is-success';
        openBtn.textContent = uiT('road_open', 'Open');

        const closedBtn = document.createElement('button');
        closedBtn.type = 'button';
        closedBtn.className = 'msp-segment__btn';
        closedBtn.textContent = uiT('road_closed', 'Closed');

        function paintRoadClosureToggle() {
            const closed = !!window.currentRoadClosureState;
            openBtn.classList.toggle('is-active', !closed);
            openBtn.classList.toggle('is-success', !closed);
            closedBtn.classList.toggle('is-active', closed);
            closedBtn.classList.toggle('is-danger', closed);
            const sentence = document.querySelector('[data-road-closure-sentence]');
            if (sentence) {
                sentence.textContent = closed
                    ? uiT('road_selected_closed', 'The road you selected is closed.')
                    : uiT('road_selected_open', 'The road you selected is open.');
                sentence.classList.toggle('is-closed', closed);
                sentence.classList.toggle('is-open', !closed);
            }
        }

        window.__paintRoadClosureToggle = paintRoadClosureToggle;

        function setClosure(next) {
            if (!requireMapEditModeForChange()) {
                return;
            }
            if (typeof window.setCurrentRoadClosure === 'function') {
                window.setCurrentRoadClosure(next, { syncInitial: false });
            } else {
                window.currentRoadClosureState = !!next;
                paintRoadClosureToggle();
            }
            patchRoadClosureOnSelectionContext(next);
            refreshSymbologyAfterRoadClosureChange();
        }

        openBtn.addEventListener('click', function (e) {
            e.preventDefault();
            setClosure(false);
        });
        closedBtn.addEventListener('click', function (e) {
            e.preventDefault();
            setClosure(true);
        });

        segment.appendChild(openBtn);
        segment.appendChild(closedBtn);
        closureBlock.appendChild(segment);

        paintRoadClosureToggle();
        form.appendChild(closureBlock);

        const deleteBlock = document.createElement('div');
        deleteBlock.className = 'msp-field';
        deleteBlock.setAttribute('data-road-delete-field', '');
        deleteBlock.hidden = true;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.id = 'mspRoadDeleteBtn';
        deleteBtn.className = 'msp-danger-btn';
        deleteBtn.innerHTML =
            '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
            '<span>' + uiT('delete_road', 'Delete road') + '</span>';
        deleteBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openRoadDeleteDialog();
        });
        deleteBlock.appendChild(deleteBtn);
        form.appendChild(deleteBlock);

        sheet.appendChild(form);
        return sheet;
    }

    function syncRiyadhRoadFieldsDataName(nameVal) {
        const v = nameVal != null ? String(nameVal) : '';
        [window.approvedLineBeingEdited, window.selectedRiyadhRoad].forEach(function (ctx) {
            if (!ctx || !ctx.is_riyadh_road) {
                return;
            }
            ctx.fields_data = ctx.fields_data && typeof ctx.fields_data === 'object' ? ctx.fields_data : {};
            ctx.fields_data.name = v;
        });
    }

    function focusRoadLabelInput() {
        const input = document.getElementById('sidebar-feature-name-input');
        if (!input) {
            return;
        }
        try {
            input.focus();
            input.select();
        } catch (eFocus) {}
    }

    function clearRoadLabelField() {
        const input = document.getElementById('sidebar-feature-name-input');
        if (input) {
            input.value = '';
            try {
                input.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (eIn) {}
        }
        syncRiyadhRoadFieldsDataName('');
    }

    function setRoadLabelFieldEditing(editing) {
        roadLabelFieldEditing = !!editing;
        syncRoadLabelFieldUI();
    }

    function beginRoadLabelEditing() {
        if (!requireMapEditModeForChange()) {
            return;
        }
        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.assertRoadEditable === 'function' &&
            typeof window.PendingRoadLocks.resolveContextRoadId === 'function'
        ) {
            const lockId = window.PendingRoadLocks.resolveContextRoadId(
                window.approvedLineBeingEdited || window.selectedRiyadhRoad
            );
            if (lockId != null && !window.PendingRoadLocks.assertRoadEditable(lockId)) {
                return;
            }
        }
        setRoadLabelFieldEditing(true);
        focusRoadLabelInput();
    }

    function syncRoadLabelFieldUI() {
        const input = document.getElementById('sidebar-feature-name-input');
        const actionBtn = document.getElementById('sidebar-road-label-action-btn');
        const viewOnly = isRoadPanelViewOnly();

        if (viewOnly) {
            roadLabelFieldEditing = false;
        }

        const editing = !viewOnly && roadLabelFieldEditing;

        if (input) {
            input.readOnly = !editing;
            input.classList.toggle('is-readonly', !editing);
            input.classList.toggle('msp-input--readonly', !editing);
            input.tabIndex = editing ? 0 : -1;
        }

        if (!actionBtn) {
            return;
        }

        // Edit / Clear only while map Edit Mode is on.
        actionBtn.hidden = viewOnly;
        if (viewOnly) {
            return;
        }

        if (editing) {
            actionBtn.textContent = uiT('clear', 'Clear');
            actionBtn.setAttribute('aria-label', uiT('remove_road_label', 'Remove road label'));
            actionBtn.setAttribute('data-action', 'clear');
            actionBtn.classList.add('msp-text-btn--clear');
            actionBtn.classList.remove('msp-text-btn--edit');
        } else {
            actionBtn.textContent = uiT('edit', 'Edit');
            actionBtn.setAttribute('aria-label', uiT('edit_road_label', 'Edit road label'));
            actionBtn.setAttribute('data-action', 'edit');
            actionBtn.classList.add('msp-text-btn--edit');
            actionBtn.classList.remove('msp-text-btn--clear');
        }
    }

    window.setRoadLabelFieldEditing = setRoadLabelFieldEditing;

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

    // Render feature symbology SVG centered in the container (preview or lightbox).
    function renderFeatureTypeVisualization(container, coordinates, options) {
        if (!container || !coordinates || coordinates.length < 2) {
            if (container) container.innerHTML = '';
            return;
        }

        options = options || {};
        const isLightbox = !!options.lightbox;

        try {
            const width = options.width || (isLightbox ? 960 : 260);
            const height = options.height || (isLightbox ? 420 : 88);
            const padding = options.padding != null ? options.padding : (isLightbox ? 36 : 14);
            const fit = options.fit != null ? options.fit : (isLightbox ? 0.92 : 0.86);

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
            const scale = Math.min(scaleX, scaleY) * fit;

            // Center the fitted geometry inside the viewBox (fixes left-biased previews).
            const drawnW = rangeX * scale;
            const drawnH = rangeY * scale;
            const offsetX = (width - drawnW) / 2;
            const offsetY = (height - drawnH) / 2;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.style.display = 'block';
            svg.style.margin = '0 auto';

            let pathData = 'M ';
            coordinates.forEach(function(coord, index) {
                const x = (coord[0] - minX) * scale + offsetX;
                const y = height - ((coord[1] - minY) * scale + offsetY);
                if (index === 0) {
                    pathData += x.toFixed(2) + ' ' + y.toFixed(2);
                } else {
                    pathData += ' L ' + x.toFixed(2) + ' ' + y.toFixed(2);
                }
            });

            const featureLabel = getCurrentFeatureLabel();
            const style = getEffectiveVisualizationStyle(featureLabel);
            if (!style) {
                renderPreviewPlaceholder(
                    container,
                    uiT('symbology_loading', 'Loading symbology…')
                );
                rerenderOnCatalogLoaded(function() {
                    renderFeatureTypeVisualization(container, coordinates, options);
                });
                return;
            }
            const scaleFactor = options.scaleFactor != null
                ? options.scaleFactor
                : (isLightbox ? 1.35 : 0.7);
            const svgDashMini = dasharrayToSvg(style);
            appendSvgFeatureSymbologyPath(svg, pathData, style, svgDashMini, scaleFactor);
            if (isRoadClosedForCurrentContext()) {
                appendClosureNoEntryIconsToSvg(
                    svg,
                    coordinates,
                    {
                        minX: minX,
                        minY: minY,
                        scale: scale,
                        offsetX: offsetX,
                        offsetY: offsetY,
                        height: height,
                    },
                    options
                );
            }

            container.innerHTML = '';
            container.appendChild(svg);
        } catch (e) {
            if (container) container.innerHTML = '';
        }
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
            folderContainer.className += ' bg-geotrak-muted';
        }

        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('class', 'w-4 h-4');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'none');
        
        let strokeColor = '#5a6f8c';
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

    var LINE_FEATURE_UI_GROUPS = [
        {
            panelLabel: 'Major Roads...',
            styleKeys: [
                'Motorway',
                'Motorway Link',
                'Trunk Road',
                'Trunk Link',
                'Primary Road',
                'Primary Link',
                'Secondary Road',
                'Secondary Link',
                'Tertiary Road',
                'Tertiary Link'
            ]
        },
        {
            panelLabel: 'Minor Roads...',
            styleKeys: [
                'Residential Road',
                'Living Street',
                'Service Road',
                'Unclassified Road',
                'Minor/Unclassified Road',
                'Track / Land-Access Road'
            ]
        },
        {
            panelLabel: 'Rails...',
            styleKeys: [
                'Train Track',
                'Disused Railway',
                'Tram Track',
                'Underground Railway Track',
                'Narrow Guage Track',
                'Light Rail Track',
                'Monorail Track',
                'Funicular Track'
            ]
        },
        {
            panelLabel: 'Paths...',
            styleKeys: [
                'Path',
                'Footway',
                'Foot Path',
                'Marked Crossing',
                'Pavement',
                'Informal Path',
                'Steps',
                'Cycleway',
                'Cycle Path',
                'Bridle Way',
                'Pedestrian Street'
            ]
        },
        {
            panelLabel: 'Waterways...',
            styleKeys: ['Stream', 'Drain', 'River', 'Canal', 'Ditch']
        },
        {
            panelLabel: 'Barrier Features...',
            styleKeys: [
                'Fence',
                'Guard Rail',
                'Wall',
                'Retaining Wall',
                'Kerb',
                'Gate',
                'Hedge',
                'Trench',
                'Barrier'
            ]
        },
        {
            panelLabel: 'Natural Features...',
            styleKeys: ['Coast Line', 'Tree Row', 'Cliff']
        },
        {
            panelLabel: 'Utility Features...',
            styleKeys: ['Power Line', 'Minor Power Line', 'Pipeline', 'Power Cable']
        }
    ];

    function buildLineFeatureDropdownOptionGroups(catalog) {
        const styles = catalog && catalog.styles_by_label;
        const covered = {};
        const groups = [];
        LINE_FEATURE_UI_GROUPS.forEach(function (def) {
            const options = [];
            (def.styleKeys || []).forEach(function (key) {
                if (!key || covered[key]) {
                    return;
                }
                if (styles && !styles[key]) {
                    return;
                }
                covered[key] = true;
                options.push({ label: key, value: key });
            });
            groups.push({ panelLabel: def.panelLabel, options: options });
        });
        if (styles) {
            const extra = [];
            Object.keys(styles).forEach(function (k) {
                if (!k || k === 'Line' || k === closureFeatureLabel() || covered[k]) {
                    return;
                }
                extra.push(k);
            });
            extra.sort();
            if (extra.length && groups.length) {
                const last = groups[groups.length - 1];
                extra.forEach(function (k) {
                    covered[k] = true;
                    last.options.push({ label: k, value: k });
                });
            }
        }
        return groups;
    }

    function getFlatLineFeatureCategoriesForSearch() {
        const flat = [];
        buildLineFeatureDropdownOptionGroups(window.symbologyCatalog).forEach(function (g) {
            const category = (g.panelLabel || '').replace(/\.\.\.$/, '').trim();
            (g.options || []).forEach(function (opt) {
                flat.push({ label: opt.label, value: opt.value, category: category });
            });
        });
        return flat;
    }

    function getFeatureTypesForSearch() {
        return getFlatLineFeatureCategoriesForSearch();
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
                searchResults.innerHTML = '<p class="msp-empty">' + uiT('feature_search_hint', 'Type to search feature types (e.g. Motorway, Path, Fence).') + '</p>';
                searchResults.style.display = 'block';
                return;
            }

            const matches = all.filter(function(item) {
                const displayLabel = displayFeatureTypeLabel(item.label || '');
                const displayCategory = displayFeatureCategoryLabel(item.category || '');
                return (item.label && item.label.toLowerCase().indexOf(q) >= 0) ||
                    (displayLabel && displayLabel.toLowerCase().indexOf(q) >= 0) ||
                    (item.category && item.category.toLowerCase().indexOf(q) >= 0) ||
                    (displayCategory && displayCategory.toLowerCase().indexOf(q) >= 0);
            });

            searchResults.innerHTML = '';
            searchResults.style.display = 'block';

            if (matches.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-xs text-zinc-500 px-2 py-4';
                empty.textContent = uiT('feature_search_no_match', 'No feature types match your search.');
                searchResults.appendChild(empty);
                return;
            }

            matches.forEach(function(item) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'w-full text-left px-3 py-2.5 text-sm text-geotrak hover:bg-geotrak-muted rounded-lg border border-transparent hover:border-geotrak-border/80 transition-colors flex items-center justify-between gap-2';
                const labelSpan = document.createElement('span');
                labelSpan.textContent = displayFeatureTypeLabel(item.label);
                const catSpan = document.createElement('span');
                catSpan.className = 'text-xs text-zinc-500 flex-shrink-0';
                catSpan.textContent = displayFeatureCategoryLabel(item.category);
                btn.appendChild(labelSpan);
                btn.appendChild(catSpan);
                btn.addEventListener("click", function() {
                    const label = item.label;
                    updateCurrentFeatureLabel(label);
                    searchInput.value = "";
                    renderSearchState("");
                    const approved = window.approvedLineBeingEdited;
                    if (approved && approved.id && approved.geometry) {
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
        const groups = buildLineFeatureDropdownOptionGroups(window.symbologyCatalog);
        setTimeout(function () {
            groups.forEach(function (g) {
                const menuId = 'dropdown-' + g.panelLabel.replace(/\s+/g, '-').toLowerCase();
                const el = document.getElementById(menuId);
                if (el && g.options && g.options.length) {
                    populateDropdownMenu(el, g.options);
                }
            });
        }, 50);
    }

    function populateDropdownMenu(dropdownMenu, options) {
        dropdownMenu.innerHTML = '';

        const dropdownLabel = dropdownMenu.getAttribute('data-dropdown-label');
        const dropdownContainer = dropdownMenu.parentElement;

        options.forEach(function(option) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'w-full text-left px-4 py-2 text-sm text-geotrak hover:bg-geotrak-subtle transition-colors first:rounded-t-lg last:rounded-b-lg';
            item.textContent = displayFeatureTypeLabel(option.label || option);
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-value', option.value || option);

            item.addEventListener("click", function() {
                const selectedValue = option.label || option;
                if (!selectedValue) return;
                updateCurrentFeatureLabel(selectedValue);

                dropdownMenu.classList.add("hidden");
                dropdownMenu.setAttribute("data-selected-value", option.value || option);

                if (dropdownContainer) {
                    const dropdownButton = dropdownContainer.querySelector("button");
                    if (dropdownButton && dropdownLabel) {
                        const labelSpan = dropdownButton.querySelector("span");
                        if (labelSpan) labelSpan.textContent = displayFeatureCategoryLabel(dropdownLabel);
                    }
                }

                const activeLineData = window.approvedLineBeingEdited || null;
                if (activeLineData) {
                    const existingFieldsData = activeLineData.fields_data || {};
                    const existingTagsData = activeLineData.tags_data || [];
                    const existingRelationsData = activeLineData.relations_data || [];

                    const updatedLineData = Object.assign({}, activeLineData, {
                        current_feature_label: selectedValue,
                        feature_type: selectedValue,
                        fields_data: existingFieldsData,
                        tags_data: existingTagsData,
                        relations_data: existingRelationsData
                    });

                    window.approvedLineBeingEdited = updatedLineData;
                    if (window.selectedRiyadhRoad) {
                        const sid = window.selectedRiyadhRoad.riyadh_road_id != null
                            ? window.selectedRiyadhRoad.riyadh_road_id
                            : window.selectedRiyadhRoad.id;
                        const uid = updatedLineData.riyadh_road_id != null
                            ? updatedLineData.riyadh_road_id
                            : updatedLineData.id;
                        if (sid != null && uid != null && String(sid) === String(uid)) {
                            window.selectedRiyadhRoad = updatedLineData;
                        }
                    }

                    setTimeout(function() {
                        showEditFeatureScreen({
                            requestGeometry: activeLineData.geometry,
                            lineData: updatedLineData
                        });
                    }, 0);
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

    function applySelectedOverlaySymbologyPaint(featureLabel) {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        ensureSelectedOverlayLayers();
        bringSelectedOverlayLayersToFront();
        const label = featureLabel || getCurrentFeatureLabel();
        const isClosed = isRoadClosedForCurrentContext();
        const style = getEffectiveVisualizationStyle(label);
        if (!style) {
            syncSelectedOverlayClosureIconsVisibility();
            syncDraftClosureMapLayers();
            return;
        }
        const lineDasharray = getEffectiveDashArray(style);
        const casingOpts = getCasingOptionsForDash(lineDasharray);
        const mls = mapLineSelection();
        const paintLabel = isClosed ? closureFeatureLabel() : label;
        const corePaint = mls.buildEditingCorePaint(style, lineDasharray, paintLabel);
        const c = corePaint['line-color'];
        const coreW = mls.isPlaceholderFeatureLabel(label) ? mls.GEOJSON_CORE_WIDTH : Number(style.lineWidth) || 4;
        const coreLineW = Number(style.lineWidth) || mls.GEOJSON_CORE_WIDTH;
        const geomEditActive =
            typeof window.__roadGeometryEditActiveId !== 'undefined' &&
            window.__roadGeometryEditActiveId != null;
        const isDraftChange = isDraftRoadClosureChangeActive();
        const postSaveOverlay = !!window.__riyadhPostSaveOverlayActive;

        if (!geomEditActive && !isDraftChange && !postSaveOverlay) {
            hideSelectedOverlayPaint();
            syncDraftClosureMapLayers();
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
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-color', c);
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-width', coreW);
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-opacity', 1);
                } else {
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-width', coreW);
                    map.setPaintProperty(SELECTED_OVERLAY_LINE_LAYER_ID, 'line-opacity', 0);
                }
            }
        } catch (e) {
        }
        syncSelectedOverlayClosureIconsVisibility();
        syncDraftClosureMapLayers();
    }

    function isRiyadhSymbologyFclassMapsReady() {
        const shared = riyadhShared();
        return !!(
            shared &&
            typeof shared.isRiyadhSymbologyFclassMapsReady === 'function' &&
            shared.isRiyadhSymbologyFclassMapsReady()
        );
    }

    function resolveRiyadhFclassForFeatureState(featureLabel) {
        const shared = riyadhShared();
        if (shared && typeof shared.resolveRiyadhFclassForFeatureState === 'function') {
            return shared.resolveRiyadhFclassForFeatureState(featureLabel);
        }
        return null;
    }

    function syncRiyadhRoadsFieldsDataFclassFromFeatureLabel(featureLabel) {
        const fc = resolveRiyadhFclassForFeatureState(featureLabel);
        [window.approvedLineBeingEdited, window.selectedRiyadhRoad].forEach(function(r) {
            if (r && r.is_riyadh_road) {
                const fd = Object.assign({}, r.fields_data || {});
                if (fc) {
                    fd.fclass = fc;
                } else {
                    delete fd.fclass;
                }
                r.fields_data = fd;
                normalizeRiyadhRoadTagsFromFields(r);
            }
        });
    }

    function updateRiyadhRoadVisualization(roadId, newFeatureLabel, geometry) {
        if (typeof window.setRiyadhRoadSelectedId === 'function') {
            if (roadId == null || roadId === '') {
                window.setRiyadhRoadSelectedId(null);
            } else {
                window.setRiyadhRoadSelectedId(roadId);
            }
        }

        const catalogReady = isRiyadhSymbologyFclassMapsReady();

        try {
            if (roadId != null) {
                if (catalogReady) {
                    const fc = resolveRiyadhFclassForFeatureState(newFeatureLabel);
                    if (fc) {
                        if (typeof window.applyRiyadhRoadDbFclassFromDatabase === 'function') {
                            window.applyRiyadhRoadDbFclassFromDatabase(roadId, fc);
                        }
                    } else if (typeof window.clearRiyadhRoadDbFclassFromDatabase === 'function') {
                        window.clearRiyadhRoadDbFclassFromDatabase(roadId);
                    }
                } else {
                    ensureSymbologyCatalogRequested();
                    rerenderOnCatalogLoaded(function () {
                        updateRiyadhRoadVisualization(roadId, newFeatureLabel, geometry);
                    });
                }
            }
        } catch (eFs) {}

        if (typeof window.syncRiyadhTileSelectionCoreForFeatureLabel === 'function') {
            try {
                window.syncRiyadhTileSelectionCoreForFeatureLabel(newFeatureLabel);
            } catch (eCore) {}
        }

        if (geometry && typeof map !== 'undefined' && map) {
            applySelectedOverlaySymbologyPaint(newFeatureLabel);
        } else {
            syncDraftClosureMapLayers();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLineDrawing);
    } else {
        initLineDrawing();
    }

    window.lineDrawingHandler = {
        getCurrentLineId: getCurrentLineId,
        getCurrentFeatureLabel: getCurrentFeatureLabel,
        getDrawInstance: function() { return drawInstance; },
        updateCurrentFeatureLabel: updateCurrentFeatureLabel,
        updateFeatureTypeVisualization: updateFeatureTypeVisualization,
        updateRiyadhRoadVisualization: updateRiyadhRoadVisualization,
        showRiyadhRoadAsLineFeature: showRiyadhRoadAsLineFeature,
        showEditFeatureScreen: showEditFeatureScreen,
        refreshAfterUndoRedo: refreshAfterUndoRedo,
        clearDraftLineDrawingFromMap: clearDraftLineDrawingFromMap,
    };

    window.getVisualizationStyle = getVisualizationStyle;
    window.syncRoadClosureStateAfterPersist = syncRoadClosureStateAfterPersist;
    window.clearDraftLineDrawingFromMap = clearDraftLineDrawingFromMap;
    window.hideSelectedOverlayPaint = hideSelectedOverlayPaint;

    function populateRoadLabelFieldsFromData(fieldsData) {
        if (!fieldsData) {
            return;
        }
        if (
            window.RiyadhRoadShared &&
            typeof window.RiyadhRoadShared.fillRoadLabelInputFromFields === 'function'
        ) {
            window.RiyadhRoadShared.fillRoadLabelInputFromFields(fieldsData);
        }
        syncRoadLabelFieldUI();
    }

    function applyEditScreenDataFromLineData(lineData) {
        if (!lineData) {
            return;
        }
        const fd = lineData.fields_data;
        if (fd && typeof fd === 'object') {
            if (typeof window.populateFieldsData === 'function') {
                window.populateFieldsData(fd);
            } else {
                populateRoadLabelFieldsFromData(fd);
            }
        }
        try {
            if (typeof window.__paintRoadClosureToggle === 'function') {
                window.__paintRoadClosureToggle();
            }
            syncRoadPanelEditModeUI();
        } catch (eSync) {}
    }

    function showRiyadhRoadAsLineFeature(lineFeatureData, options) {
        if (!lineFeatureData) return;

        const opts = options || {};
        const enterEditMode = opts.enterEditMode === true;

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
            requestGeometry: lineFeatureData.geometry || null,
            lineData: window.approvedLineBeingEdited,
        });

        try {
            updateCurrentFeatureLabel(featureLabel);
        } catch (e) {}

        if (enterEditMode && window.autoEnterEditModeOnRoadSelection) {
            setTimeout(function() {
                window.autoEnterEditModeOnRoadSelection();
            }, 0);
        } else {
            setTimeout(function() {
                syncRoadPanelEditModeUI();
            }, 0);
        }
        notifyMapSelectionChanged();
    }

    window.showRiyadhRoadAsLineFeature = showRiyadhRoadAsLineFeature;
    window.clearMapRoadSelection = clearMapRoadSelection;
    window.hasMapRoadSelection = hasMapRoadSelection;

    window.setSelectedOverlayGeometry = setSelectedOverlayGeometry;
    window.syncDraftClosureMapLayers = syncDraftClosureMapLayers;

    try {
        if (window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
            setSymbologyCatalog(window.symbologyCatalog);
        }
    } catch (e) {}
})();
