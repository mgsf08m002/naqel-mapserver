(function() {
    'use strict';

    const REQUIRED_ZOOM_LEVEL = 16;
    const EDIT_BUTTON_ID = 'editButton';
    const MAX_RETRY_ATTEMPTS = 50;
    const SIDE_PANEL_WIDTH = 320;

    let retryCount = 0;
    let isEditModeActive = false;
    let currentTool = null;

    let editButton = null;
    let sidePanel = null;
    let mapContainer = null;
    let editToolbar = null;
    let zoomOverlay = null;
    let zoomInBtn = null;

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

        setupEventListeners();
        updateButtonState();
    }

    function setupEventListeners() {
        editButton.addEventListener('click', handleEditButtonClick);
        map.on('zoom', updateButtonState);
        map.on('zoomend', handleZoomEnd);
        map.on('load', updateButtonState);

        const pointBtn = document.getElementById('pointToolBtn');
        const lineBtn = document.getElementById('lineToolBtn');
        const areaBtn = document.getElementById('areaToolBtn');
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (pointBtn) pointBtn.addEventListener('click', function() { selectTool('point'); });
        if (lineBtn) lineBtn.addEventListener('click', function() { selectTool('line'); });
        if (areaBtn) areaBtn.addEventListener('click', function() { selectTool('area'); });
        if (undoBtn) undoBtn.addEventListener('click', function() {});
        if (redoBtn) redoBtn.addEventListener('click', function() {});
        if (zoomInBtn) zoomInBtn.addEventListener('click', handleZoomIn);
    }

    function handleEditButtonClick(event) {
        event.preventDefault();

        if (editButton.disabled) {
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
            return;
        }
        updateButtonText('Exit Edit Mode');
        if (typeof window.initMapSidePanelChrome === 'function') {
            window.initMapSidePanelChrome();
        }
        if (typeof window.applyMapSidePanelOpen === 'function') {
            window.applyMapSidePanelOpen(true);
        } else if (sidePanel) {
            sidePanel.classList.remove('-translate-x-full');
            sidePanel.style.display = '';
            sidePanel.style.visibility = 'visible';
            sidePanel.style.opacity = '1';
            sidePanel.style.setProperty('transform', 'translateX(0)', 'important');
        }
        if (editToolbar) {
            editToolbar.classList.remove('hidden');
        }
        if (typeof window.refreshRiyadhGeometryEditToolbar === 'function') {
            window.refreshRiyadhGeometryEditToolbar();
        }
        if (mapContainer && typeof window.applyMapSidePanelOpen !== 'function') {
            mapContainer.style.marginLeft = SIDE_PANEL_WIDTH + 'px';
            mapContainer.style.width = 'calc(100% - ' + SIDE_PANEL_WIDTH + 'px)';
        }
        if (map && map.getContainer()) {
            map.getContainer().style.opacity = '1';
            map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
        }
        setTimeout(function() {
            if (map && map.resize) {
                map.resize();
            }
            checkZoomLevel();
            ensureSidePanelInitialContent();
        }, 350);
    }

    function ensureSidePanelInitialContent() {
        const searchResults = document.getElementById('featureSearchResults');
        if (!searchResults) return;
        const hasContent = searchResults.innerHTML.trim().length > 0;
        if (!hasContent) {
            searchResults.style.display = 'block';
            searchResults.innerHTML = '<p class="text-xs text-gray-400 px-1 py-4">Type above to search feature types, or draw a line on the map to choose from the list.</p>';
        }
    }

    function exitEditMode() {
        updateButtonText('Edit');
        if (sidePanel) {
            const editScreen = document.getElementById('editFeatureScreen');
            const sidePanelContent = document.getElementById('sidePanelContent');
            const hasContent = editScreen || (sidePanelContent && sidePanelContent.children.length > 0);
            if (!hasContent) {
                sidePanel.classList.add('-translate-x-full');
                if (mapContainer) {
                    mapContainer.style.marginLeft = '0';
                    mapContainer.style.width = '100%';
                    setTimeout(function() {
                        if (map && map.resize) {
                            map.resize();
                        }
                    }, 300);
                }
            }
        }
        if (editToolbar) {
            editToolbar.classList.add('hidden');
        }
        if (typeof window.hideRiyadhGeometryEditToolbar === 'function') {
            window.hideRiyadhGeometryEditToolbar();
        }
        if (zoomOverlay) {
            zoomOverlay.classList.add('hidden');
        }
        if (map && map.getContainer()) {
            map.getContainer().style.opacity = '1';
            map.getContainer().style.pointerEvents = 'auto';
            map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
        }
        currentTool = null;
        updateToolButtons();
    }

    function updateButtonState() {
        try {
            const currentZoom = map.getZoom();
            const isZoomSufficient = currentZoom >= REQUIRED_ZOOM_LEVEL;

            if (isZoomSufficient) {
                editButton.disabled = false;
                editButton.setAttribute('aria-disabled', 'false');
            } else {
                editButton.disabled = true;
                editButton.setAttribute('aria-disabled', 'true');
                if (isEditModeActive) {
                    checkZoomLevel();
                }
            }
        } catch (error) {}
    }

    function handleZoomEnd() {
        updateButtonState();

        if (isEditModeActive) {
            checkZoomLevel();
        }
    }

    function checkZoomLevel() {
        if (!isEditModeActive || !zoomOverlay) {
            return;
        }

        const currentZoom = map.getZoom();
        const isZoomSufficient = currentZoom >= REQUIRED_ZOOM_LEVEL;

        if (isZoomSufficient) {
            zoomOverlay.classList.add('hidden');
            if (map.getContainer()) {
                map.getContainer().style.opacity = '1';
                map.getContainer().style.pointerEvents = 'auto';
                map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
            }
        } else {
            zoomOverlay.classList.remove('hidden');
            if (map.getContainer()) {
                map.getContainer().style.opacity = '0.85';
                map.getContainer().style.pointerEvents = 'none';
                map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
            }
        }
    }

    function handleZoomIn() {
        if (!map) return;

        const currentCenter = map.getCenter();
        map.easeTo({
            center: currentCenter,
            zoom: REQUIRED_ZOOM_LEVEL,
            duration: 800
        });
    }

    function updateButtonText(text) {
        const textSpan = editButton.querySelector('span');
        if (textSpan) {
            textSpan.textContent = text;
        }
    }

    function selectTool(tool) {
        currentTool = tool;
        updateToolButtons();
        let terraDrawInstance = null;
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            terraDrawInstance = drawInstance;
        } else if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            terraDrawInstance = draw.getTerraDrawInstance();
        }

        if (!terraDrawInstance) {
            return;
        }
        const modeMap = {
            point: 'point',
            line: 'linestring',
            area: 'polygon'
        };

        const terraDrawMode = modeMap[tool];
        if (!terraDrawMode) {
            return;
        }

        try {
            terraDrawInstance.setMode(terraDrawMode);
        } catch (error) {}
    }

    function updateToolButtons() {
        const pointBtn = document.getElementById('pointToolBtn');
        const lineBtn = document.getElementById('lineToolBtn');
        const areaBtn = document.getElementById('areaToolBtn');
        [pointBtn, lineBtn, areaBtn].forEach(function(btn) {
            if (btn) {
                btn.classList.remove('bg-gray-200', 'ring-2', 'ring-black');
                btn.classList.add('hover:bg-gray-100');
            }
        });
        const activeBtn =
            currentTool === 'point' ? pointBtn :
            currentTool === 'line' ? lineBtn :
            currentTool === 'area' ? areaBtn : null;

        if (activeBtn) {
            activeBtn.classList.add('bg-gray-200', 'ring-2', 'ring-black');
            activeBtn.classList.remove('hover:bg-gray-100');
        }
    }

    function autoEnterEditModeOnRoadSelection() {
        if (window.managerApprovalReviewActive) {
            return;
        }
        if (!editButton || typeof map === 'undefined' || !map) {
            return;
        }
        let z;
        try {
            z = map.getZoom();
        } catch (e) {
            return;
        }
        if (z < REQUIRED_ZOOM_LEVEL) {
            return;
        }
        if (isEditModeActive) {
            if (typeof window.refreshRiyadhGeometryEditToolbar === 'function') {
                window.refreshRiyadhGeometryEditToolbar();
            }
            checkZoomLevel();
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

    window.autoEnterEditModeOnRoadSelection = autoEnterEditModeOnRoadSelection;
})();
