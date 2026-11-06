(function() {
    'use strict';

    const REQUIRED_ZOOM_LEVEL = 16;
    const EDIT_BUTTON_ID = 'editButton';
    const MAX_RETRY_ATTEMPTS = 50;
    const MAP_ZOOM_GATE_OPACITY = '0.85';

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    let retryCount = 0;
    let isEditModeActive = false;
    let currentTool = null;

    let editButton = null;
    let sidePanel = null;
    let mapContainer = null;
    let editToolbar = null;
    let zoomOverlay = null;
    let zoomInBtn = null;
    let zoomOverlayCurrentEl = null;
    let zoomOverlayRequiredEl = null;

    function getMapZoom() {
        try {
            return map.getZoom();
        } catch (e) {
            return null;
        }
    }

    function isZoomSufficient(zoom) {
        return typeof zoom === 'number' && zoom >= REQUIRED_ZOOM_LEVEL;
    }

    function formatZoomLevel(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return '-';
        }
        return (Math.round(value * 10) / 10).toFixed(1);
    }

    function getMapLibreContainer() {
        try {
            return map && map.getContainer ? map.getContainer() : null;
        } catch (e) {
            return null;
        }
    }

    function setMapLibreInteractive(enabled) {
        const container = getMapLibreContainer();
        if (!container) {
            return;
        }
        container.style.opacity = enabled ? '1' : MAP_ZOOM_GATE_OPACITY;
        container.style.pointerEvents = enabled ? 'auto' : 'none';
        container.style.transition = 'opacity 0.3s ease-in-out';
    }

    function setZoomOverlayVisible(visible) {
        if (!zoomOverlay) {
            return;
        }
        zoomOverlay.classList.toggle('hidden', !visible);
        zoomOverlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function syncZoomOverlayLevels(currentZoom) {
        const zoom = typeof currentZoom === 'number' ? currentZoom : getMapZoom();
        if (zoomOverlayCurrentEl) {
            zoomOverlayCurrentEl.textContent = formatZoomLevel(zoom);
        }
        if (zoomOverlayRequiredEl) {
            zoomOverlayRequiredEl.textContent = formatZoomLevel(REQUIRED_ZOOM_LEVEL);
        }
    }

    function refreshZoomGate() {
        if (!isEditModeActive || !zoomOverlay) {
            return;
        }

        const currentZoom = getMapZoom();
        const ok = isZoomSufficient(currentZoom);
        syncZoomOverlayLevels(currentZoom);
        setZoomOverlayVisible(!ok);
        setMapLibreInteractive(ok);
    }

    function hideZoomGate() {
        setZoomOverlayVisible(false);
        setMapLibreInteractive(true);
    }

    function syncEditButtonZoomState() {
        const currentZoom = getMapZoom();
        if (currentZoom == null || !editButton) {
            return;
        }

        const reviewing = !!window.managerApprovalReviewActive;
        const ok = !reviewing && isZoomSufficient(currentZoom);
        editButton.disabled = !ok;
        editButton.setAttribute('aria-disabled', ok ? 'false' : 'true');
        editButton.classList.toggle('is-review-locked', reviewing);
        if (isEditModeActive) {
            refreshZoomGate();
        }
    }

    function forceExitMapEditModeForReview() {
        if (!isEditModeActive) {
            syncEditButtonZoomState();
            return;
        }
        isEditModeActive = false;
        exitEditMode();
        syncEditButtonZoomState();
    }

    function zoomToEditLevel() {
        if (!map) {
            return;
        }
        map.easeTo({
            center: map.getCenter(),
            zoom: REQUIRED_ZOOM_LEVEL,
            duration: 800
        });
    }

    function initEditMode() {
        editButton = document.getElementById(EDIT_BUTTON_ID);

        if (!editButton) {
            return;
        }

        if (typeof map === 'undefined' || !map) {
            retryCount++;
            if (retryCount < MAX_RETRY_ATTEMPTS) {
                setTimeout(initEditMode, 100);
            }
            return;
        }

        sidePanel = document.getElementById('editSidePanel');
        mapContainer = document.getElementById('mapContainer');
        editToolbar = document.getElementById('editToolbar');
        zoomOverlay = document.getElementById('zoomOverlay');
        zoomInBtn = document.getElementById('zoomInBtn');
        zoomOverlayCurrentEl = document.getElementById('zoomOverlayCurrent');
        zoomOverlayRequiredEl = document.getElementById('zoomOverlayRequired');
        syncZoomOverlayLevels(getMapZoom());

        setupEventListeners();
        syncEditButtonZoomState();
    }

    function setupEventListeners() {
        editButton.addEventListener('click', handleEditButtonClick);
        map.on('zoom', syncEditButtonZoomState);
        map.on('zoomend', syncEditButtonZoomState);
        map.on('load', syncEditButtonZoomState);

        const lineBtn = document.getElementById('lineToolBtn');
        if (lineBtn) lineBtn.addEventListener('click', activateDrawRoadTool);
        if (zoomInBtn) zoomInBtn.addEventListener('click', zoomToEditLevel);
    }

    function handleEditButtonClick(event) {
        event.preventDefault();

        if (editButton.disabled) {
            return;
        }

        // During manager approval review the map is view-only - never enter edit.
        if (window.managerApprovalReviewActive) {
            if (isEditModeActive) {
                isEditModeActive = false;
                exitEditMode();
            }
            return;
        }

        isEditModeActive = !isEditModeActive;

        if (isEditModeActive) {
            enterEditMode();
        } else {
            exitEditMode();
        }
    }

    function enterEditMode() {
        if (window.managerApprovalReviewActive) {
            isEditModeActive = false;
            return;
        }
        updateButtonText(uiT('exit_edit_mode', 'Exit Edit Mode'));
        if (typeof window.initMapSidePanelChrome === 'function') {
            window.initMapSidePanelChrome();
        }
        if (typeof window.applyMapSidePanelOpen === 'function') {
            window.applyMapSidePanelOpen(true);
        }
        if (editToolbar) {
            editToolbar.classList.remove('hidden');
        }
        if (mapContainer) {
            mapContainer.classList.add('map-edit-toolbar-active');
        }
        if (typeof window.syncClearSelectionPosition === 'function') {
            window.syncClearSelectionPosition();
        }
        if (typeof window.refreshRiyadhGeometryEditToolbar === 'function') {
            window.refreshRiyadhGeometryEditToolbar();
        }
        setTimeout(function() {
            refreshZoomGate();
            ensureSidePanelInitialContent();
            if (typeof window.syncRoadPanelEditModeUI === 'function') {
                window.syncRoadPanelEditModeUI();
            }
            if (window.mapEditUndo && typeof window.mapEditUndo.onEditModeEntered === 'function') {
                window.mapEditUndo.onEditModeEntered();
            }
            if (typeof window.syncClearSelectionPosition === 'function') {
                window.syncClearSelectionPosition();
            }
        }, 350);
    }

    function ensureSidePanelInitialContent() {
        const searchResults = document.getElementById('featureSearchResults');
        if (!searchResults) return;
        const hasContent = searchResults.innerHTML.trim().length > 0;
        if (!hasContent) {
            searchResults.style.display = 'block';
            searchResults.innerHTML = '<p class="msp-empty">' + uiT('feature_search_empty', 'Type to search feature types, or draw a road on the map first.') + '</p>';
        }
    }

    function exitEditMode() {
        updateButtonText(uiT('edit', 'Edit'));
        if (sidePanel) {
            const editScreen = document.getElementById('editFeatureScreen');
            const sidePanelContent = document.getElementById('sidePanelContent');
            const hasContent = editScreen || (sidePanelContent && sidePanelContent.children.length > 0);
            if (!hasContent && typeof window.applyMapSidePanelOpen === 'function') {
                window.applyMapSidePanelOpen(false);
            }
        }
        if (editToolbar) {
            editToolbar.classList.add('hidden');
        }
        if (mapContainer) {
            mapContainer.classList.remove('map-edit-toolbar-active');
        }
        if (typeof window.syncClearSelectionPosition === 'function') {
            window.syncClearSelectionPosition();
        }
        if (typeof window.hideRiyadhGeometryEditToolbar === 'function') {
            window.hideRiyadhGeometryEditToolbar();
        }
        hideZoomGate();
        currentTool = null;
        updateDrawRoadToolButton();
        if (typeof window.syncRoadPanelEditModeUI === 'function') {
            window.syncRoadPanelEditModeUI();
        }
        if (window.mapEditUndo && typeof window.mapEditUndo.onEditModeExited === 'function') {
            window.mapEditUndo.onEditModeExited();
        }
    }

    function updateButtonText(text) {
        const textSpan = editButton.querySelector('span');
        if (textSpan) {
            textSpan.textContent = text;
        }
    }

    function activateDrawRoadTool() {
        currentTool = 'line';
        updateDrawRoadToolButton();
        let terraDrawInstance = null;
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getDrawInstance === 'function') {
            terraDrawInstance = window.lineDrawingHandler.getDrawInstance();
        }
        if (!terraDrawInstance && typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            terraDrawInstance = draw.getTerraDrawInstance();
        }
        if (!terraDrawInstance) {
            return;
        }
        try {
            terraDrawInstance.setMode('linestring');
        } catch (error) {}
        if (window.mapEditUndo && typeof window.mapEditUndo.beginDrawSession === 'function') {
            window.mapEditUndo.beginDrawSession();
        }
    }

    function updateDrawRoadToolButton() {
        const lineBtn = document.getElementById('lineToolBtn');
        if (!lineBtn) {
            return;
        }
        const active = currentTool === 'line';
        lineBtn.classList.toggle('is-active', active);
        lineBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function autoEnterEditModeOnRoadSelection() {
        if (window.managerApprovalReviewActive) {
            return;
        }
        if (!editButton || typeof map === 'undefined' || !map) {
            return;
        }
        if (!isZoomSufficient(getMapZoom())) {
            return;
        }
        if (isEditModeActive) {
            if (typeof window.refreshRiyadhGeometryEditToolbar === 'function') {
                window.refreshRiyadhGeometryEditToolbar();
            }
            refreshZoomGate();
            return;
        }
        isEditModeActive = true;
        enterEditMode();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEditMode);
    } else {
        initEditMode();
    }

    window.exitEditModeAfterSuccessfulSave = function() {
        if (!isEditModeActive) {
            return;
        }
        isEditModeActive = false;
        exitEditMode();
    };

    window.forceExitMapEditModeForReview = forceExitMapEditModeForReview;

    window.syncEditButtonReviewState = syncEditButtonZoomState;

    window.isMapEditModeActive = function() {
        return isEditModeActive;
    };

    window.promptEnableEditMode = function() {
        if (window.managerApprovalReviewActive) {
            return;
        }
        if (window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(uiT('edit_mode_required', 'Turn on Edit Mode first, then you can make changes.'), 'info');
        }
    };

    window.autoEnterEditModeOnRoadSelection = autoEnterEditModeOnRoadSelection;
})();
