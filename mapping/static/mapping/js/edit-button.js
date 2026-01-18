/**
 * Edit Mode Controller
 * Handles Edit button visibility, edit mode toggle, side panel, toolbar, and zoom overlay.
 */

(function() {
    'use strict';

    // Constants
    const REQUIRED_ZOOM_LEVEL = 16;
    const EDIT_BUTTON_ID = 'editButton';
    const MAX_RETRY_ATTEMPTS = 50;
    const SIDE_PANEL_WIDTH = 320; // 80 * 4 = 320px (w-80)
    
    // State
    let retryCount = 0;
    let isEditModeActive = false;
    let currentTool = null;
    
    // DOM Elements
    let editButton = null;
    let sidePanel = null;
    let mapContainer = null;
    let editToolbar = null;
    let zoomOverlay = null;
    let zoomInBtn = null;

    /**
     * Initialize the edit mode controller
     */
    function initEditMode() {
        editButton = document.getElementById(EDIT_BUTTON_ID);
        
        // If button doesn't exist, user doesn't have permission or it's not a map page
        if (!editButton) {
            return;
        }

        // Wait for map to be initialized
        if (typeof map === 'undefined' || !map) {
            retryCount++;
            if (retryCount < MAX_RETRY_ATTEMPTS) {
                setTimeout(initEditMode, 100);
            }
            return;
        }

        // Get DOM elements
        sidePanel = document.getElementById('editSidePanel');
        mapContainer = document.getElementById('mapContainer');
        editToolbar = document.getElementById('editToolbar');
        zoomOverlay = document.getElementById('zoomOverlay');
        zoomInBtn = document.getElementById('zoomInBtn');

        // Initialize event listeners
        setupEventListeners();
        
        // Set initial button state
        updateButtonState();
        
        // Listen for TerraDraw mode changes to sync button states
        syncTerraDrawMode();
    }

    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        // Edit button click
        editButton.addEventListener('click', handleEditButtonClick);
        
        // Zoom events for button state
        map.on('zoom', updateButtonState);
        map.on('zoomend', handleZoomEnd);
        map.on('load', function() {
            updateButtonState();
        });

        // Toolbar buttons
        const pointBtn = document.getElementById('pointToolBtn');
        const lineBtn = document.getElementById('lineToolBtn');
        const areaBtn = document.getElementById('areaToolBtn');
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const saveBtn = document.getElementById('saveBtn');

        if (pointBtn) pointBtn.addEventListener('click', () => selectTool('point'));
        if (lineBtn) lineBtn.addEventListener('click', () => selectTool('line'));
        if (areaBtn) areaBtn.addEventListener('click', () => selectTool('area'));
        if (undoBtn) undoBtn.addEventListener('click', handleUndo);
        if (redoBtn) redoBtn.addEventListener('click', handleRedo);
        // Save button is handled by save-line-edit.js to avoid duplicate calls
        // if (saveBtn) saveBtn.addEventListener('click', handleSave);
        if (zoomInBtn) zoomInBtn.addEventListener('click', handleZoomIn);
    }

    /**
     * Handle edit button click - toggle edit mode
     */
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

    /**
     * Enter edit mode
     */
    function enterEditMode() {
        // Update button text
        updateButtonText('Exit Edit Mode');
        
        // Show side panel
        if (sidePanel) {
            sidePanel.classList.remove('-translate-x-full');
        }
        
        // Show toolbar
        if (editToolbar) {
            editToolbar.classList.remove('hidden');
        }
        
        // Resize map container to accommodate panel
        if (mapContainer) {
            mapContainer.style.marginLeft = SIDE_PANEL_WIDTH + 'px';
            mapContainer.style.width = `calc(100% - ${SIDE_PANEL_WIDTH}px)`;
        }
        
        // Ensure map starts with full opacity
        if (map && map.getContainer()) {
            map.getContainer().style.opacity = '1';
            map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
        }
        
        // Trigger map resize after a short delay to ensure panel is visible
        setTimeout(() => {
            if (map && map.resize) {
                map.resize();
            }
            // Check zoom level after resize
            checkZoomLevel();
        }, 350);
    }

    /**
     * Exit edit mode
     */
    function exitEditMode() {
        // Update button text
        updateButtonText('Edit');
        
        // Hide side panel ONLY if there's no content being viewed
        // This allows sidebar to remain open for viewing lines/roads even when edit mode is disabled
        if (sidePanel) {
            const editScreen = document.getElementById('editFeatureScreen');
            const sidePanelContent = document.getElementById('sidePanelContent');
            const hasContent = editScreen || (sidePanelContent && sidePanelContent.children.length > 0);
            
            // Only hide sidebar if it's truly empty (no viewing content)
            if (!hasContent) {
                sidePanel.classList.add('-translate-x-full');
                
                // Reset map container size only if sidebar is being hidden
                if (mapContainer) {
                    mapContainer.style.marginLeft = '0';
                    mapContainer.style.width = '100%';
                    
                    // Trigger map resize
                    setTimeout(() => {
                        if (map && map.resize) {
                            map.resize();
                        }
                    }, 300);
                }
            }
            // If sidebar has content (viewing mode), keep it visible and map container adjusted
            // Map container width is already set by showLineSidePanel/showApprovedLineDetails
        }
        
        // Hide toolbar
        if (editToolbar) {
            editToolbar.classList.add('hidden');
        }
        
        // Hide zoom overlay
        if (zoomOverlay) {
            zoomOverlay.classList.add('hidden');
        }
        
        // Restore map opacity and interactions
        if (map && map.getContainer()) {
            map.getContainer().style.opacity = '1';
            map.getContainer().style.pointerEvents = 'auto';
            map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
        }
        
        // Reset tool selection
        currentTool = null;
        updateToolButtons();
    }

    /**
     * Update button state based on zoom level
     */
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
                
                // If in edit mode and zoomed out, show overlay
                if (isEditModeActive) {
                    checkZoomLevel();
                }
            }
        } catch (error) {
            // Error updating button state
        }
    }

    /**
     * Handle zoom end event
     */
    function handleZoomEnd() {
        updateButtonState();
        
        if (isEditModeActive) {
            checkZoomLevel();
        }
    }

    /**
     * Check zoom level and show/hide overlay
     */
    function checkZoomLevel() {
        if (!isEditModeActive || !zoomOverlay) {
            return;
        }

        const currentZoom = map.getZoom();
        const isZoomSufficient = currentZoom >= REQUIRED_ZOOM_LEVEL;

        if (isZoomSufficient) {
            zoomOverlay.classList.add('hidden');
            // Restore map opacity
            if (map.getContainer()) {
                map.getContainer().style.opacity = '1';
                map.getContainer().style.pointerEvents = 'auto';
                map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
            }
        } else {
            zoomOverlay.classList.remove('hidden');
            // Make map slightly dimmed but still clearly visible, and disable interactions
            if (map.getContainer()) {
                map.getContainer().style.opacity = '0.85';
                map.getContainer().style.pointerEvents = 'none';
                map.getContainer().style.transition = 'opacity 0.3s ease-in-out';
            }
        }
    }

    /**
     * Handle zoom in button click
     */
    function handleZoomIn() {
        if (!map) return;
        
        const currentCenter = map.getCenter();
        map.easeTo({
            center: currentCenter,
            zoom: REQUIRED_ZOOM_LEVEL,
            duration: 800
        });
    }

    /**
     * Update button text
     */
    function updateButtonText(text) {
        const textSpan = editButton.querySelector('span');
        if (textSpan) {
            textSpan.textContent = text;
        }
    }

    /**
     * Select a tool (Point, Line, Area)
     */
    function selectTool(tool) {
        currentTool = tool;
        updateToolButtons();
        
        // Get TerraDraw instance - check multiple possible variable names
        let terraDrawInstance = null;
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            terraDrawInstance = drawInstance;
        } else if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            terraDrawInstance = draw.getTerraDrawInstance();
        }
        
        if (!terraDrawInstance) {
            return;
        }
        
        // Map tool names to TerraDraw mode names
        const modeMap = {
            'point': 'point',
            'line': 'linestring',
            'area': 'polygon'
        };
        
        const terraDrawMode = modeMap[tool];
        if (!terraDrawMode) {
            return;
        }
        
        try {
            // Set the TerraDraw mode
            terraDrawInstance.setMode(terraDrawMode);
        } catch (error) {
            // Error setting TerraDraw mode
        }
    }

    /**
     * Update tool button states (highlight active tool)
     */
    function updateToolButtons() {
        const pointBtn = document.getElementById('pointToolBtn');
        const lineBtn = document.getElementById('lineToolBtn');
        const areaBtn = document.getElementById('areaToolBtn');

        // Reset all buttons
        [pointBtn, lineBtn, areaBtn].forEach(btn => {
            if (btn) {
                btn.classList.remove('bg-gray-200', 'ring-2', 'ring-black');
                btn.classList.add('hover:bg-gray-100');
            }
        });

        // Highlight active tool
        const activeBtn = 
            currentTool === 'point' ? pointBtn :
            currentTool === 'line' ? lineBtn :
            currentTool === 'area' ? areaBtn : null;

        if (activeBtn) {
            activeBtn.classList.add('bg-gray-200', 'ring-2', 'ring-black');
            activeBtn.classList.remove('hover:bg-gray-100');
        }
    }

    /**
     * Handle undo action
     */
    function handleUndo() {
        // TODO: Implement undo logic
        // Example: You can use TerraDraw undo functionality
        // if (drawInstance && drawInstance.undo) {
        //     drawInstance.undo();
        // }
    }

    /**
     * Handle redo action
     */
    function handleRedo() {
        // TODO: Implement redo logic
        // Example: You can use TerraDraw redo functionality
        // if (drawInstance && drawInstance.redo) {
        //     drawInstance.redo();
        // }
    }

    /**
     * Handle save action
     */
    function handleSave() {
        // Delegate to save-line-edit.js handler if available
        // This prevents duplicate calls - save-line-edit.js handles the actual save
        if (typeof window.handleSaveLineEdit === 'function') {
            window.handleSaveLineEdit();
            return;
        }
        
        // Fallback: Get TerraDraw instance
        let terraDrawInstance = null;
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            terraDrawInstance = drawInstance;
        } else if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            terraDrawInstance = draw.getTerraDrawInstance();
        }
        
        if (!terraDrawInstance) {
            return;
        }
        
        try {
            // Get current drawings
            const snapshot = terraDrawInstance.getSnapshot();
            
            // TODO: Send snapshot to server
            // Example: Send to backend API
            // fetch('/api/save-drawings/', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ features: snapshot })
            // });
        } catch (error) {
            // Error saving drawings
        }
    }

    /**
     * Sync toolbar button states with TerraDraw mode
     */
    function syncTerraDrawMode() {
        // Get TerraDraw instance
        let terraDrawInstance = null;
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            terraDrawInstance = drawInstance;
        } else if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            terraDrawInstance = draw.getTerraDrawInstance();
        }
        
        if (!terraDrawInstance) {
            return;
        }
        
        // Listen for mode changes from TerraDraw (if available)
        // This ensures button states stay in sync if user clicks left toolbar
        try {
            if (typeof terraDrawInstance.on === 'function') {
                // Note: TerraDraw may not expose mode change events directly
                // This is a placeholder for potential future integration
            }
        } catch (error) {
            // Mode change events may not be available in TerraDraw API
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEditMode);
    } else {
        initEditMode();
    }

    // Export cleanup function
    window.editModeCleanup = function() {
        if (map) {
            map.off('zoom', updateButtonState);
            map.off('zoomend', handleZoomEnd);
        }
        if (editButton) {
            editButton.removeEventListener('click', handleEditButtonClick);
        }
    };
})();
