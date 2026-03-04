/**
 * Line Drawing Handler
 * Manages line drawing, MapLibre layer rendering, and sidepanel UI
 */

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
    let currentFeatureLabel = 'Line';

    // Centralized symbology catalog (fetched from backend symbology app)
    // Shape matches `symbology.feature_catalog.SymbologyCatalog`.
    let symbologyCatalog = null;
    let symbologyStylesByLabel = null; // normalized by lower-cased label
    let symbologyCatalogRequested = false;

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16),
              }
            : { r: 239, g: 68, b: 68 };
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

        // Expose for other scripts (e.g., manager-requests.js, load-approved-lines.js)
        window.symbologyCatalog = catalog;
    }

    function ensureSymbologyCatalogRequested() {
        if (symbologyCatalogRequested || symbologyCatalog) {
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
                // Fail gracefully; callers will fall back to default style.
            });
    }

    function getVisualizationStyle(featureLabel) {
        // Ensure the catalog request has been kicked off early.
        ensureSymbologyCatalogRequested();

        const normalizedLabel = normalizeFeatureLabel(featureLabel || 'Line');

        if (symbologyStylesByLabel && symbologyStylesByLabel[normalizedLabel]) {
            return symbologyStylesByLabel[normalizedLabel];
        }

        // Default style when catalog is not yet available or label not defined.
        return {
            lineColor: '#ffffff',
            glowColor: '#ef4444',
            lineWidth: 4,
            glowWidth: 10,
            glowOpacity: 0.5,
            markerColor: '#ffffff',
            markerGlowColor: '#ef4444',
        };
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

            sidePanel = document.getElementById('editSidePanel');
            sidePanelContent = document.getElementById('sidePanelContent');

            setupLineDrawingListeners();
            startHidingDefaultRendering();
            
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
                    forceMarkersVisibility();
                    applyGlowingEffect(id);
                    updateLineVisualization();
                    
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
            applyGlowingEffect(id);

            setTimeout(function() {
                hideDefaultRendering();
                renderLineAsMapLibreLayer(id);
                forceMarkersVisibility();
            }, 100);
        } catch (error) {
            selectedLineId = id;
            currentLineId = id;
            
            if (!currentFeatureLabel) {
                updateCurrentFeatureLabel('Line');
            }
            
            applyGlowingEffect(id);
            forceMarkersVisibility();
        }
    }

    function applyGlowingEffect(id) {
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.setAttribute('data-selected-line', id);
        }
        hideDefaultRendering();
    }

    function handleFeatureSelected(id) {
        if (!drawInstance) {
            return;
        }

        try {
            // Clear any previously selected Riyadh road
            if (window.currentlySelectedItemType === 'riyadh-road' && typeof clearSelectedRiyadhRoad === 'function') {
                clearSelectedRiyadhRoad();
            } else if (window.currentlySelectedItemType === 'riyadh-road' && typeof window.clearSelectedRiyadhRoad === 'function') {
                window.clearSelectedRiyadhRoad();
            }
            
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });

            if (feature && feature.geometry) {
                if (feature.geometry.type === 'LineString') {
                    selectedLineId = id;
                    currentLineId = id;
                    
                    // Update selection tracking
                    window.currentlySelectedItem = id;
                    window.currentlySelectedItemType = 'terradraw-line';
                    
                    hideDefaultRendering();
                    renderLineAsMapLibreLayer(id);
                    applyGlowingEffect(id);
                    
                    // Ensure select mode is active for future clicks
                    try {
                        const currentMode = drawInstance.getMode();
                        if (currentMode !== 'select') {
                            drawInstance.setMode('select');
                        }
                    } catch (e) {
                        // Could not set select mode, continue anyway
                    }
                    
                    showLineSidePanel();
                    updateCurrentFeatureLabel('Line');
                    forceMarkersVisibility();
                    updateLineVisualization();
                    
                    setTimeout(function() {
                        hideDefaultRendering();
                    }, 50);
                    setTimeout(function() {
                        hideDefaultRendering();
                    }, 200);
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
    }

    /**
     * Show Search Features screen for approved line editing (Editor/System Admin)
     */
    function showLineSidePanelForApprovedLineEdit(featureLabel) {
        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) {
            setTimeout(function() {
                showLineSidePanelForApprovedLineEdit(featureLabel);
            }, 100);
            return;
        }

        // Get approved line data BEFORE removing edit screen
        const editScreen = document.getElementById('editFeatureScreen');
        let approvedLineId = null;
        let approvedLineGeometry = null;
        let approvedLineData = null;
        
        if (editScreen) {
            approvedLineId = editScreen.getAttribute('data-approved-line-id');
            const geometryAttr = editScreen.getAttribute('data-approved-line-geometry');
            const lineDataAttr = editScreen.getAttribute('data-line-data');
            
            if (geometryAttr) {
                try {
                    approvedLineGeometry = JSON.parse(geometryAttr);
                } catch (e) {
                    // Error parsing geometry
                }
            }
            
            if (lineDataAttr) {
                try {
                    approvedLineData = JSON.parse(lineDataAttr);
                } catch (e) {
                    // Error parsing line data
                }
            }
            
            // Also try to get from window storage
            if (approvedLineId && window.approvedLinesBeingEdited && window.approvedLinesBeingEdited[approvedLineId]) {
                approvedLineData = window.approvedLinesBeingEdited[approvedLineId];
                if (!approvedLineGeometry && approvedLineData.geometry) {
                    approvedLineGeometry = approvedLineData.geometry;
                }
            }
            
            // Store in window for dropdown selection
            if (approvedLineData) {
                window.approvedLineBeingEdited = approvedLineData;
            }
            
            // Remove edit feature screen
            editScreen.remove();
        } else {
            // Try to get from window storage if edit screen not found
            if (window.approvedLineBeingEdited) {
                approvedLineData = window.approvedLineBeingEdited;
                approvedLineGeometry = approvedLineData.geometry;
                approvedLineId = approvedLineData.id;
            }
        }

        // Show default sidepanel elements
        showSidePanelDefaultElements();

        // Hide search results if visible
        const searchResults = document.getElementById('featureSearchResults');
        if (searchResults) {
            searchResults.style.display = 'none';
        }

        // Ensure content area is visible
        const contentArea = document.querySelector('#editSidePanel .flex-1.overflow-y-auto');
        if (contentArea) {
            contentArea.style.display = 'block';
        }

        // Update current feature label to the one from approved line BEFORE creating dropdowns
        const labelToUse = featureLabel || (approvedLineData ? (approvedLineData.current_feature_label || approvedLineData.feature_type || 'Line') : 'Line');
        if (labelToUse) {
            updateCurrentFeatureLabel(labelToUse);
        }

        // Ensure dropdowns container exists and is visible
        let dropdownsContainer = document.getElementById('lineDropdownsContainer');
        
        if (!dropdownsContainer) {
            // Create dropdowns container if it doesn't exist
            if (!sidePanelContent) {
                setTimeout(function() {
                    showLineSidePanelForApprovedLineEdit(featureLabel);
                }, 100);
                return;
            }

            sidePanelContent.innerHTML = '';

            const visualizationContainer = createLineVisualization();
            if (visualizationContainer) {
                sidePanelContent.appendChild(visualizationContainer);
                // Ensure the feature name is updated after container is created
                const featureNameElement = document.getElementById('lineVisualizationFeatureName');
                if (featureNameElement && labelToUse) {
                    featureNameElement.textContent = labelToUse;
                }
            }

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

            sidePanelContent.appendChild(dropdownsContainer);
            populateDropdowns();
        } else {
            // Ensure dropdowns container is visible
            dropdownsContainer.style.display = 'block';
            
            // Check if visualization container exists, if not create it
            let visualizationContainer = document.getElementById('lineVisualizationContainer');
            if (!visualizationContainer && sidePanelContent) {
                visualizationContainer = createLineVisualization();
                if (visualizationContainer) {
                    // Insert before dropdowns container
                    sidePanelContent.insertBefore(visualizationContainer, dropdownsContainer);
                    // Update feature name
                    const featureNameElement = document.getElementById('lineVisualizationFeatureName');
                    if (featureNameElement && labelToUse) {
                        featureNameElement.textContent = labelToUse;
                    }
                }
            } else if (visualizationContainer) {
                // Ensure visualization container is visible
                visualizationContainer.style.display = 'block';
                // Update feature name if it exists
                const featureNameElement = document.getElementById('lineVisualizationFeatureName');
                if (featureNameElement && labelToUse) {
                    featureNameElement.textContent = labelToUse;
                }
                // Ensure SVG container is also visible
                const svgContainer = document.getElementById('lineVisualizationSVG');
                if (svgContainer) {
                    svgContainer.style.display = 'block';
                }
            }
        }
        
        // Update visualization - do this for both new and existing containers
        setTimeout(function() {
            updateSearchFeatureScreenSelection();
            
            // Get the latest feature label from stored data (in case it was updated)
            let finalFeatureLabel = labelToUse;
            if (approvedLineData) {
                const latestLabel = approvedLineData.current_feature_label || approvedLineData.feature_type;
                if (latestLabel && latestLabel !== finalFeatureLabel) {
                    finalFeatureLabel = latestLabel;
                    updateCurrentFeatureLabel(finalFeatureLabel);
                }
            }
            
            // Ensure we have geometry - try multiple sources
            let geometryToUse = approvedLineGeometry;
            if (!geometryToUse && approvedLineData && approvedLineData.geometry) {
                geometryToUse = approvedLineData.geometry;
            }
            if (!geometryToUse && window.approvedLineBeingEdited && window.approvedLineBeingEdited.geometry) {
                geometryToUse = window.approvedLineBeingEdited.geometry;
            }
            
            // Check if SVG container exists before updating
            let svgContainer = document.getElementById('lineVisualizationSVG');
            
            if (!svgContainer) {
                // If SVG container doesn't exist, try to create visualization container
                if (sidePanelContent) {
                    let visualizationContainer = document.getElementById('lineVisualizationContainer');
                    if (!visualizationContainer) {
                        visualizationContainer = createLineVisualization();
                        if (visualizationContainer) {
                            const dropdownsContainer = document.getElementById('lineDropdownsContainer');
                            if (dropdownsContainer) {
                                sidePanelContent.insertBefore(visualizationContainer, dropdownsContainer);
                            } else {
                                sidePanelContent.appendChild(visualizationContainer);
                            }
                            // Update feature name
                            const featureNameElement = document.getElementById('lineVisualizationFeatureName');
                            if (featureNameElement && finalFeatureLabel) {
                                featureNameElement.textContent = finalFeatureLabel;
                            }
                        }
                    }
                }
                // Retry after a short delay if container was just created
                setTimeout(function() {
                    const retrySvgContainer = document.getElementById('lineVisualizationSVG');
                    if (retrySvgContainer && geometryToUse) {
                        updateLineVisualizationFromGeometry(geometryToUse, finalFeatureLabel);
                    }
                }, 100);
                return;
            }
            
            // Ensure SVG container is visible
            svgContainer.style.display = 'block';
            
            // Update visualization using approved line geometry if available
            if (geometryToUse) {
                updateLineVisualizationFromGeometry(geometryToUse, finalFeatureLabel);
                
                // Verify visualization after a short delay to catch any clearing
                setTimeout(function() {
                    const verifySvg = document.getElementById('lineVisualizationSVG');
                    if (verifySvg) {
                        const svg = verifySvg.querySelector('svg');
                        // If SVG was cleared, recreate it
                        if (!svg && geometryToUse) {
                            updateLineVisualizationFromGeometry(geometryToUse, finalFeatureLabel);
                        }
                    }
                }, 200);
            } else {
                // Fallback message
                svgContainer.innerHTML = '<div class="text-gray-400 text-xs p-4 text-center">No visualization available</div>';
            }
        }, 150);
    }

    function showLineSidePanel() {
        // Always ensure sidebar is visible (works in both edit mode and view mode)
        const sidePanel = document.getElementById('editSidePanel');
        if (sidePanel) {
            sidePanel.classList.remove('-translate-x-full');
            sidePanel.style.display = '';
            sidePanel.style.visibility = 'visible';
            sidePanel.style.opacity = '1';
            
            // Force show with important styles
            sidePanel.style.setProperty('transform', 'translateX(0)', 'important');
            
            // Adjust map container width
            const mapContainer = document.getElementById('mapContainer');
            if (mapContainer) {
                const SIDE_PANEL_WIDTH = 320;
                mapContainer.style.marginLeft = SIDE_PANEL_WIDTH + 'px';
                mapContainer.style.width = `calc(100% - ${SIDE_PANEL_WIDTH}px)`;
                
                setTimeout(function() {
                    if (map && map.resize) {
                        map.resize();
                    }
                }, 300);
            }
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
            searchResults.style.display = 'none';
        }

        const contentArea = document.querySelector('#editSidePanel .flex-1.overflow-y-auto');
        if (contentArea) {
            contentArea.style.display = 'block';
        }

        let dropdownsContainer = document.getElementById('lineDropdownsContainer');
        
        if (!dropdownsContainer) {
            sidePanelContent.innerHTML = '';

            const visualizationContainer = createLineVisualization();
            if (visualizationContainer) {
                sidePanelContent.appendChild(visualizationContainer);
            }

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

            sidePanelContent.appendChild(dropdownsContainer);
            populateDropdowns();
            updateLineVisualization();
        } else {
            dropdownsContainer.style.display = 'block';
            updateLineVisualization();
        }
    }

    function createLineVisualization() {
        const container = document.createElement('div');
        container.id = 'lineVisualizationContainer';
        container.className = 'mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700';
        container.style.display = 'block'; // Ensure container is visible

        const labelText = document.createElement('div');
        labelText.className = 'text-xs font-medium text-gray-400 mb-2';
        labelText.textContent = 'Current Feature';
        container.appendChild(labelText);

        const valueDisplay = document.createElement('div');
        valueDisplay.id = 'lineVisualizationFeatureName';
        valueDisplay.className = 'text-sm font-semibold text-white mb-3';
        // Use current feature label instead of hardcoding 'Line'
        valueDisplay.textContent = currentFeatureLabel || 'Line';
        container.appendChild(valueDisplay);

        const svgContainer = document.createElement('div');
        svgContainer.id = 'lineVisualizationSVG';
        svgContainer.className = 'relative w-full';
        svgContainer.style.height = '200px';
        svgContainer.style.width = '100%';
        svgContainer.style.minHeight = '200px';
        svgContainer.style.backgroundColor = '#1f2937';
        svgContainer.style.borderRadius = '4px';
        svgContainer.style.overflow = 'hidden';
        svgContainer.style.display = 'block';
        svgContainer.style.visibility = 'visible';
        svgContainer.style.opacity = '1';
        container.appendChild(svgContainer);

        return container;
    }

    /**
     * Update line visualization from provided geometry (for approved lines)
     */
    function updateLineVisualizationFromGeometry(geometry, featureLabel) {
        const svgContainer = document.getElementById('lineVisualizationSVG');
        if (!svgContainer) {
            return;
        }
        
        if (!geometry) {
            return;
        }

        try {
            if (geometry.type !== 'LineString') {
                return;
            }

            const coordinates = geometry.coordinates;
            if (!coordinates || coordinates.length < 2) {
                svgContainer.innerHTML = '';
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

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            
            const blurFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            blurFilter.setAttribute('id', 'blur-approved');
            blurFilter.setAttribute('x', '-50%');
            blurFilter.setAttribute('y', '-50%');
            blurFilter.setAttribute('width', '200%');
            blurFilter.setAttribute('height', '200%');
            const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
            feGaussianBlur.setAttribute('stdDeviation', '4');
            blurFilter.appendChild(feGaussianBlur);
            defs.appendChild(blurFilter);
            svg.appendChild(defs);

            // Use same coordinate transformation as working updateLineVisualization function
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

            // Get visualization style based on feature label
            const labelToUse = featureLabel || getCurrentFeatureLabel();
            const style = getVisualizationStyle(labelToUse);

            // Draw glow path
            const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            glowPath.setAttribute('d', pathData);
            glowPath.setAttribute('fill', 'none');
            glowPath.setAttribute('stroke', style.glowColor);
            glowPath.setAttribute('stroke-width', style.glowWidth.toString());
            glowPath.setAttribute('stroke-opacity', style.glowOpacity.toString());
            glowPath.setAttribute('stroke-linecap', 'round');
            glowPath.setAttribute('stroke-linejoin', 'round');
            glowPath.setAttribute('filter', 'url(#blur-approved)');
            svg.appendChild(glowPath);

            // Draw main line path
            const mainPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            mainPath.setAttribute('d', pathData);
            mainPath.setAttribute('fill', 'none');
            mainPath.setAttribute('stroke', style.lineColor);
            mainPath.setAttribute('stroke-width', style.lineWidth.toString());
            mainPath.setAttribute('stroke-opacity', '1');
            mainPath.setAttribute('stroke-linecap', 'round');
            mainPath.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(mainPath);

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

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            
            const blurFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            blurFilter.setAttribute('id', 'blur');
            blurFilter.setAttribute('x', '-50%');
            blurFilter.setAttribute('y', '-50%');
            blurFilter.setAttribute('width', '200%');
            blurFilter.setAttribute('height', '200%');

            const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
            feGaussianBlur.setAttribute('stdDeviation', '6');
            blurFilter.appendChild(feGaussianBlur);
            defs.appendChild(blurFilter);
            svg.appendChild(defs);

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

            const style = getVisualizationStyle(currentFeatureLabel);

            const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            glowPath.setAttribute('d', pathData);
            glowPath.setAttribute('fill', 'none');
            glowPath.setAttribute('stroke', style.glowColor);
            glowPath.setAttribute('stroke-width', style.glowWidth.toString());
            glowPath.setAttribute('stroke-opacity', style.glowOpacity.toString());
            glowPath.setAttribute('filter', 'url(#blur)');
            glowPath.setAttribute('stroke-linecap', 'round');
            glowPath.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(glowPath);

            const mainPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            mainPath.setAttribute('d', pathData);
            mainPath.setAttribute('fill', 'none');
            mainPath.setAttribute('stroke', style.lineColor);
            mainPath.setAttribute('stroke-width', style.lineWidth.toString());
            mainPath.setAttribute('stroke-opacity', '1');
            mainPath.setAttribute('stroke-linecap', 'round');
            mainPath.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(mainPath);

            svgContainer.innerHTML = '';
            svgContainer.appendChild(svg);

        } catch (e) {
            // Error updating line visualization
        }
    }

    function updateCurrentFeatureLabel(featureType) {
        if (!featureType) {
            featureType = 'Line';
        }
        
        currentFeatureLabel = featureType;
        
        const valueDisplay = document.getElementById('currentFeatureValue');
        if (valueDisplay) {
            valueDisplay.textContent = currentFeatureLabel;
        }
        
        const visualizationFeatureName = document.getElementById('lineVisualizationFeatureName');
        if (visualizationFeatureName) {
            visualizationFeatureName.textContent = currentFeatureLabel;
        }

        const selectedFeatureName = document.getElementById('selectedFeatureName');
        if (selectedFeatureName) {
            selectedFeatureName.textContent = currentFeatureLabel;
        }

        if (currentLineId) {
            renderLineAsMapLibreLayer(currentLineId);
            forceMarkersVisibility();
        }
        
        // Only update visualization if we're not editing an approved line
        // (approved lines use updateLineVisualizationFromGeometry instead)
        if (!window.approvedLineBeingEdited) {
            updateLineVisualization();
            updateFeatureTypeVisualization();
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
            const glowLayerId = 'drawn-line-glow-' + id;
            
            if (!map.loaded() || !map.isStyleLoaded()) {
                map.once('load', function() {
                    renderLineAsMapLibreLayer(id);
                });
                map.once('style.load', function() {
                    renderLineAsMapLibreLayer(id);
                });
                return;
            }
            
            const style = getVisualizationStyle(currentFeatureLabel);
            
            const existingSource = map.getSource(sourceId);
            const existingGlowLayer = map.getLayer(glowLayerId);
            const existingLayer = map.getLayer(layerId);
            
            if (existingSource && existingSource.setData && existingGlowLayer && existingLayer) {
                try {
                    existingSource.setData({
                        type: 'FeatureCollection',
                        features: [feature]
                    });
                    
                    map.setPaintProperty(glowLayerId, 'line-color', style.glowColor);
                    map.setPaintProperty(glowLayerId, 'line-width', style.glowWidth);
                    map.setPaintProperty(glowLayerId, 'line-opacity', style.glowOpacity);
                    
                    map.setPaintProperty(layerId, 'line-color', style.lineColor);
                    map.setPaintProperty(layerId, 'line-width', style.lineWidth);
                    
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
                if (map.getLayer(glowLayerId)) {
                    map.removeLayer(glowLayerId);
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
            
            map.addLayer({
                id: glowLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': style.glowColor,
                    'line-width': style.glowWidth,
                    'line-opacity': style.glowOpacity,
                    'line-blur': 6
                }
            });
            
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': style.lineColor,
                    'line-width': style.lineWidth,
                    'line-opacity': 1
                }
            });
            
            if (!map._drawnLineLayers) {
                map._drawnLineLayers = {};
            }
            map._drawnLineLayers[id] = {
                sourceId: sourceId,
                layerId: layerId,
                glowLayerId: glowLayerId
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
            if (map.getLayer(layers.glowLayerId)) {
                map.removeLayer(layers.glowLayerId);
            }
            if (map.getSource(layers.sourceId)) {
                map.removeSource(layers.sourceId);
            }
            
            delete map._drawnLineLayers[id];
        } catch (e) {
            // Error removing MapLibre line layer
        }
    }

    function forceMarkersVisibility() {
        // Vertex markers have been removed to keep the visualization
        // purely line-based. This function now only ensures that any
        // previously created markers are cleared.
        clearVertexMarkers();
    }

    function createDropdownBox(label, isLast) {
        const container = document.createElement('div');
        container.className = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg px-4 py-3 text-left text-white transition-colors duration-200 flex items-center justify-between group';
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
        chevron.className = 'w-4 h-4 text-gray-400 group-hover:text-white transition-colors';
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
        buttonContent.appendChild(chevron);

        button.appendChild(buttonContent);

        const dropdownMenu = document.createElement('div');
        dropdownMenu.id = 'dropdown-' + label.replace(/\s+/g, '-').toLowerCase();
        dropdownMenu.className = 'hidden absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto';
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
        button.className = 'w-full bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg px-4 py-3 text-left text-white transition-colors duration-200 flex items-center justify-between group';
        button.setAttribute('data-line-box', 'true');

        const iconContainer = document.createElement('div');
        iconContainer.className = 'flex-shrink-0 w-6 h-6 flex items-center justify-center';

        const folderContainer = document.createElement('div');
        folderContainer.className = 'w-5 h-5 rounded flex items-center justify-center bg-gray-500/20';

        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('class', 'w-4 h-4');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'none');
        iconSvg.setAttribute('stroke', '#9CA3AF');
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
        chevron.className = 'w-4 h-4 text-gray-400 group-hover:text-white transition-colors';
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
        const isApprovedLine = options.isApprovedLine || false;
        const approvedLineId = options.approvedLineId || null;
        
        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) return;
        
        // Always ensure sidebar is visible (works in both edit mode and view mode)
        // This is critical for viewing lines/roads when edit mode is disabled
        sidePanel.classList.remove('-translate-x-full');
        sidePanel.style.display = '';
        
        // Adjust map container width
        const mapContainer = document.getElementById('mapContainer');
        if (mapContainer) {
            const SIDE_PANEL_WIDTH = 320;
            mapContainer.style.marginLeft = SIDE_PANEL_WIDTH + 'px';
            mapContainer.style.width = `calc(100% - ${SIDE_PANEL_WIDTH}px)`;
            
            setTimeout(function() {
                if (map && map.resize) {
                    map.resize();
                }
            }, 300);
        }

        const existingEditScreen = document.getElementById('editFeatureScreen');
        if (existingEditScreen) {
            existingEditScreen.remove();
        }

        if (!currentFeatureLabel) {
            currentFeatureLabel = 'Line';
        }

        hideSidePanelDefaultElements();

        const flexContainer = sidePanel.querySelector('.h-full.flex.flex-col');
        if (!flexContainer) return;

        const editScreen = document.createElement('div');
        editScreen.id = 'editFeatureScreen';
        editScreen.className = 'h-full flex flex-col bg-gray-800';
        
        // Store request geometry for visualization
        if (requestGeometry) {
            editScreen.setAttribute('data-request-geometry', JSON.stringify(requestGeometry));
        }
        
        // Store line data if provided
        if (lineData) {
            editScreen.setAttribute('data-line-data', JSON.stringify(lineData));
        }
        
        // Store approved line information if provided
        if (isApprovedLine && approvedLineId) {
            editScreen.setAttribute('data-approved-line-id', approvedLineId.toString());
            editScreen.setAttribute('data-is-approved-line', 'true');
            // Store the original geometry for saving edits
            if (requestGeometry) {
                editScreen.setAttribute('data-approved-line-geometry', JSON.stringify(requestGeometry));
            }
        }

        const header = document.createElement('div');
        header.className = 'px-6 py-4 border-b border-gray-700 flex items-center justify-between';

        const backButton = document.createElement('button');
        backButton.className = 'p-2 hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0';
        backButton.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>';
        
        // Hide back button if viewing a request or if manager viewing approved line
        if (hideBackButton) {
            backButton.style.display = 'none';
        } else {
            backButton.addEventListener('click', function() {
                // Check if this is an approved line being edited
                const isApprovedLine = editScreen.getAttribute('data-is-approved-line') === 'true';
                const approvedLineId = editScreen.getAttribute('data-approved-line-id');
                
                if (isApprovedLine && approvedLineId) {
                    // Prioritize window storage (most up-to-date) over edit screen attributes
                    let lineData = null;
                    let featureLabel = null; // Don't use getCurrentFeatureLabel() as it might have default 'Line' value
                    
                    // First, try to get from window storage (most up-to-date, especially after dropdown changes)
                    if (window.approvedLineBeingEdited && window.approvedLineBeingEdited.id === parseInt(approvedLineId)) {
                        lineData = window.approvedLineBeingEdited;
                    } else if (window.approvedLinesBeingEdited && window.approvedLinesBeingEdited[approvedLineId]) {
                        lineData = window.approvedLinesBeingEdited[approvedLineId];
                        window.approvedLineBeingEdited = lineData;
                    }
                    
                    // Fallback to edit screen data if window storage doesn't have it
                    if (!lineData) {
                        const lineDataAttr = editScreen.getAttribute('data-line-data');
                        
                        if (lineDataAttr) {
                            try {
                                lineData = JSON.parse(lineDataAttr);
                                
                                // Store in window for future use
                                window.approvedLineBeingEdited = lineData;
                                if (!window.approvedLinesBeingEdited) {
                                    window.approvedLinesBeingEdited = {};
                                }
                                window.approvedLinesBeingEdited[approvedLineId] = lineData;
                            } catch (e) {
                                // Error parsing line data
                            }
                        }
                    }
                    
                    // Get feature label from line data (prioritize current_feature_label, then feature_type)
                    if (lineData) {
                        // Prioritize current_feature_label over feature_type
                        featureLabel = lineData.current_feature_label || lineData.feature_type;
                    } else {
                        // Last resort: use getCurrentFeatureLabel() if no lineData found
                        featureLabel = getCurrentFeatureLabel();
                    }
                    
                    // Fallback to 'Line' only if featureLabel is still null/undefined
                    if (!featureLabel) {
                        featureLabel = 'Line';
                    }
                    
                    showLineSidePanelForApprovedLineEdit(featureLabel);
                } else {
                    // Normal flow: just show the side panel
                    showLineSidePanel();
                }
            });
        }

        const title = document.createElement('h2');
        title.className = 'text-lg font-semibold text-white flex-1 text-center';
        title.textContent = 'Edit feature';

        const closeButton = document.createElement('button');
        closeButton.className = 'p-2 hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0';
        closeButton.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
        
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
        header.appendChild(closeButton);
        editScreen.appendChild(header);

        const content = document.createElement('div');
        content.className = 'flex-1 overflow-y-auto';

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

        setTimeout(function() {
            updateFeatureTypeLabelDisplay();
            // Update visualization - use request geometry if available
            if (requestGeometry) {
                updateFeatureTypeVisualizationFromGeometry(requestGeometry);
            } else {
                updateFeatureTypeVisualization();
            }
            
            // Populate existing data if editing an approved line
            if (isApprovedLine && lineData) {
                setTimeout(function() {
                    // Populate fields data - try manager-requests.js first, then load-approved-lines.js
                    if (lineData.fields_data) {
                        if (typeof window.populateFieldsData === 'function') {
                            window.populateFieldsData(lineData.fields_data);
                        } else if (typeof window.populateFieldsDataForApprovedLine === 'function') {
                            window.populateFieldsDataForApprovedLine(lineData.fields_data);
                        }
                    }
                    
                    // Populate tags data
                    if (lineData.tags_data) {
                        if (typeof window.populateTagsData === 'function') {
                            window.populateTagsData(lineData.tags_data);
                        } else if (typeof window.populateTagsDataForApprovedLine === 'function') {
                            window.populateTagsDataForApprovedLine(lineData.tags_data);
                        }
                    }
                    
                    // Populate relations data
                    if (lineData.relations_data) {
                        if (typeof window.populateRelationsData === 'function') {
                            window.populateRelationsData(lineData.relations_data);
                        } else if (typeof window.populateRelationsDataForApprovedLine === 'function') {
                            window.populateRelationsDataForApprovedLine(lineData.relations_data);
                        }
                    }
                }, 300);
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

        const flexContainer = sidePanel.querySelector('.h-full.flex.flex-col');
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

        const flexContainer = sidePanel.querySelector('.h-full.flex.flex-col');
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
        container.className = 'border-b border-gray-700';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700 transition-colors group';
        button.setAttribute('data-menu-item', 'featureType');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium text-blue-400 group-hover:text-blue-300 transition-colors';
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
        selectorContainer.className = 'flex items-center gap-3';

        const visualizationContainer = document.createElement('div');
        visualizationContainer.id = 'featureTypeVisualization';
        visualizationContainer.className = 'flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity';
        visualizationContainer.style.width = '60px';
        visualizationContainer.style.height = '30px';
        visualizationContainer.style.backgroundColor = '#1f2937';
        visualizationContainer.style.borderRadius = '4px';
        visualizationContainer.style.overflow = 'hidden';
        
        // Check if we're in view-only mode (manager viewing request)
        const editScreen = document.getElementById('editFeatureScreen');
        const isViewOnly = editScreen && editScreen.getAttribute('data-request-geometry');
        
        if (!isViewOnly) {
            visualizationContainer.setAttribute('title', 'Click to change feature type');
            visualizationContainer.addEventListener('click', function() {
                updateSearchFeatureScreenSelection();
                showLineSidePanel();
            });
        } else {
            visualizationContainer.style.cursor = 'default';
            visualizationContainer.classList.remove('cursor-pointer', 'hover:opacity-80');
        }

        const selectedFeatureName = document.createElement('div');
        selectedFeatureName.id = 'selectedFeatureName';
        selectedFeatureName.className = 'text-sm font-semibold text-white cursor-pointer hover:text-blue-300 transition-colors';
        selectedFeatureName.textContent = labelToSet;
        
        if (!isViewOnly) {
            selectedFeatureName.setAttribute('title', 'Click to change feature type');
            selectedFeatureName.addEventListener('click', function() {
                updateSearchFeatureScreenSelection();
                showLineSidePanel();
            });
        } else {
            selectedFeatureName.style.cursor = 'default';
            selectedFeatureName.classList.remove('cursor-pointer', 'hover:text-blue-300');
        }

        selectorContainer.appendChild(visualizationContainer);
        selectorContainer.appendChild(selectedFeatureName);

        container.appendChild(selectorContainer);

        return container;
    }

    /**
     * Update Feature Type visualization from request geometry (for manager viewing requests)
     */
    function updateFeatureTypeVisualizationFromGeometry(geometry) {
        const container = document.getElementById('featureTypeVisualization');
        if (!container || !geometry || geometry.type !== 'LineString') return;

        const coordinates = geometry.coordinates;
        if (!coordinates || coordinates.length < 2) {
            if (container) container.innerHTML = '';
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
                    renderFeatureTypeVisualization(container, requestGeometry.coordinates);
                    return;
                }
            } catch (e) {
                // Error parsing request geometry
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

    /**
     * Render the Feature Type visualization SVG
     */
    function renderFeatureTypeVisualization(container, coordinates) {
        if (!container || !coordinates || coordinates.length < 2) {
            if (container) container.innerHTML = '';
            return;
        }

        try {
            const width = 60;
            const height = 30;
            const padding = 4;

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
            const scale = Math.min(scaleX, scaleY) * 0.8;

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const offsetX = width / 2 - centerX * scale;
            const offsetY = height / 2 - centerY * scale;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width.toString());
            svg.setAttribute('height', height.toString());
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.style.display = 'block';

            const filterId = 'blur-small-' + Date.now();
            
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const blurFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            blurFilter.setAttribute('id', filterId);
            blurFilter.setAttribute('x', '-50%');
            blurFilter.setAttribute('y', '-50%');
            blurFilter.setAttribute('width', '200%');
            blurFilter.setAttribute('height', '200%');
            const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
            feGaussianBlur.setAttribute('stdDeviation', '1.5');
            blurFilter.appendChild(feGaussianBlur);
            defs.appendChild(blurFilter);
            svg.appendChild(defs);

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
            const style = getVisualizationStyle(featureLabel);
            const scaleFactor = 0.25;

            const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            glowPath.setAttribute('d', pathData);
            glowPath.setAttribute('fill', 'none');
            glowPath.setAttribute('stroke', style.glowColor);
            glowPath.setAttribute('stroke-width', (style.glowWidth * scaleFactor).toString());
            glowPath.setAttribute('stroke-opacity', style.glowOpacity.toString());
            glowPath.setAttribute('stroke-linecap', 'round');
            glowPath.setAttribute('stroke-linejoin', 'round');
            glowPath.setAttribute('filter', 'url(#' + filterId + ')');
            svg.appendChild(glowPath);

            const mainPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            mainPath.setAttribute('d', pathData);
            mainPath.setAttribute('fill', 'none');
            mainPath.setAttribute('stroke', style.lineColor);
            mainPath.setAttribute('stroke-width', (style.lineWidth * scaleFactor).toString());
            mainPath.setAttribute('stroke-opacity', '1');
            mainPath.setAttribute('stroke-linecap', 'round');
            mainPath.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(mainPath);

            container.innerHTML = '';
            container.appendChild(svg);
        } catch (e) {
            if (container) container.innerHTML = '';
        }
    }

    function createFieldsMenuItem() {
        window.selectedFields = [];
        const container = document.createElement('div');
        container.className = 'border-b border-gray-700';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700 transition-colors group';
        button.setAttribute('data-menu-item', 'fields');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium text-blue-400 group-hover:text-blue-300 transition-colors';
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
        existingFieldsContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-3';

        const nameField = createFieldItem('Name', false, true, true);
        existingFieldsContainer.appendChild(nameField);

        const commonNameInput = document.createElement('input');
        commonNameInput.type = 'text';
        commonNameInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        commonNameInput.placeholder = '';
        existingFieldsContainer.appendChild(commonNameInput);

        fieldsContainer.appendChild(existingFieldsContainer);

        const addFieldSection = document.createElement('div');
        addFieldSection.className = 'space-y-1.5';
        addFieldSection.id = 'add-field-section';

        const addFieldLabel = document.createElement('label');
        addFieldLabel.className = 'text-xs text-gray-300';
        addFieldLabel.textContent = 'Add field:';
        addFieldSection.appendChild(addFieldLabel);

        const addFieldDropdown = document.createElement('div');
        addFieldDropdown.className = 'relative';
        addFieldDropdown.id = 'add-field-dropdown';

        const dropdownInput = document.createElement('input');
        dropdownInput.type = 'text';
        dropdownInput.className = 'w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer';
        dropdownInput.placeholder = 'Description, Fix Me, Image...';
        dropdownInput.readOnly = true;
        dropdownInput.id = 'add-field-input';

        const dropdownChevron = document.createElement('div');
        dropdownChevron.className = 'absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none';
        dropdownChevron.innerHTML = '<svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-50 hidden';
        dropdownMenu.id = 'add-field-menu';

        const fieldOptions = ['Description', 'Fix Me', 'Image', 'Last Checked Date', 'Mapillary Image ID', 'Note', 'Panoramax Image ID', 'Website'];
        fieldOptions.forEach(function(option) {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-3 py-2 text-sm text-white hover:bg-gray-600 cursor-pointer flex items-center';
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
        roadClosureSection.className = 'mt-4 pt-3 border-t border-gray-700';

        const roadClosureLabel = document.createElement('div');
        roadClosureLabel.className = 'text-xs text-gray-300 mb-2';
        roadClosureLabel.textContent = 'Road Closure';
        roadClosureSection.appendChild(roadClosureLabel);

        const roadClosureToggleRow = document.createElement('div');
        roadClosureToggleRow.className = 'flex items-center justify-between gap-3';

        const roadClosureNoLabel = document.createElement('span');
        roadClosureNoLabel.className = 'text-xs font-medium text-gray-300';
        roadClosureNoLabel.textContent = 'NO';

        const roadClosureYesLabel = document.createElement('span');
        roadClosureYesLabel.className = 'text-xs font-medium text-gray-500';
        roadClosureYesLabel.textContent = 'YES';

        const roadClosureToggleButton = document.createElement('button');
        roadClosureToggleButton.type = 'button';
        roadClosureToggleButton.className = 'relative inline-flex h-6 w-11 items-center rounded-full bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900';
        roadClosureToggleButton.setAttribute('aria-pressed', 'false');
        roadClosureToggleButton.setAttribute('aria-label', 'Toggle road closure');

        const roadClosureToggleKnob = document.createElement('span');
        roadClosureToggleKnob.className = 'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform translate-x-0';

        roadClosureToggleButton.appendChild(roadClosureToggleKnob);

        let isRoadClosed = false;

        function updateRoadClosureToggleVisualState() {
            if (isRoadClosed) {
                roadClosureToggleButton.classList.remove('bg-gray-700');
                roadClosureToggleButton.classList.add('bg-green-500');
                roadClosureToggleKnob.classList.remove('translate-x-0');
                roadClosureToggleKnob.classList.add('translate-x-5');
                roadClosureToggleButton.setAttribute('aria-pressed', 'true');
                roadClosureNoLabel.classList.remove('text-gray-300');
                roadClosureNoLabel.classList.add('text-gray-500');
                roadClosureYesLabel.classList.remove('text-gray-500');
                roadClosureYesLabel.classList.add('text-gray-100');
            } else {
                roadClosureToggleButton.classList.remove('bg-green-500');
                roadClosureToggleButton.classList.add('bg-gray-700');
                roadClosureToggleKnob.classList.remove('translate-x-5');
                roadClosureToggleKnob.classList.add('translate-x-0');
                roadClosureToggleButton.setAttribute('aria-pressed', 'false');
                roadClosureNoLabel.classList.remove('text-gray-500');
                roadClosureNoLabel.classList.add('text-gray-300');
                roadClosureYesLabel.classList.remove('text-gray-100');
                roadClosureYesLabel.classList.add('text-gray-500');
            }
        }

        roadClosureToggleButton.addEventListener('click', function (e) {
            e.preventDefault();
            isRoadClosed = !isRoadClosed;
            updateRoadClosureToggleVisualState();
        });

        roadClosureToggleRow.appendChild(roadClosureNoLabel);
        roadClosureToggleRow.appendChild(roadClosureToggleButton);
        roadClosureToggleRow.appendChild(roadClosureYesLabel);

        roadClosureSection.appendChild(roadClosureToggleRow);

        updateRoadClosureToggleVisualState();

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
        labelSpan.className = 'text-xs text-white';
        labelSpan.textContent = label;
        leftSection.appendChild(labelSpan);

        fieldContainer.appendChild(leftSection);

        const rightSection = document.createElement('div');
        rightSection.className = 'flex items-center gap-1.5 flex-shrink-0';

        if (hasInfoIcon) {
            const infoButton = document.createElement('button');
            infoButton.type = 'button';
            infoButton.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
            infoButton.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
            rightSection.appendChild(infoButton);
        }

        if (hasPlusIcon) {
            const plusButtonWrapper = document.createElement('div');
            plusButtonWrapper.className = 'relative group';

            const plusButton = document.createElement('button');
            plusButton.type = 'button';
            plusButton.className = 'w-5 h-5 flex items-center justify-center rounded bg-gray-600 hover:bg-gray-500 transition-colors';
            plusButton.innerHTML = '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>';

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
        container.className = 'border-b border-gray-700';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700 transition-colors group';
        button.setAttribute('data-menu-item', 'tags');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium text-blue-400 group-hover:text-blue-300 transition-colors';
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
            leftInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer';
            leftInput.placeholder = 'Add new tag';
            leftInput.readOnly = true;

            const leftChevron = document.createElement('div');
            leftChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
            leftChevron.innerHTML = '<svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

            const leftMenu = document.createElement('div');
            leftMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-50 hidden max-h-60 overflow-y-auto';

            const tagOptions = ['building', 'highway', 'source', 'name', 'surface', 'natural', 'addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'];
            tagOptions.forEach(function(option) {
                const menuItem = document.createElement('div');
                menuItem.className = 'px-3 py-2 text-xs text-white hover:bg-gray-600 cursor-pointer border-b border-gray-600 last:border-b-0';
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
            rightInput.className = 'flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
            rightInput.placeholder = '';

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 transition-colors flex-shrink-0';
            deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        addTagButton.className = 'w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-md text-xs text-white transition-colors';
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
        const existingFieldsContainer = fieldsContainer.querySelector('.bg-gray-700.rounded-lg');
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
        container.className = 'border-b border-gray-700';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700 transition-colors group';
        button.setAttribute('data-menu-item', 'relations');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium text-blue-400 group-hover:text-blue-300 transition-colors';
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
            parentInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer';
            parentInput.placeholder = 'Choose a parent relation';
            parentInput.value = 'New Relation';
            parentInput.readOnly = true;

            const parentChevron = document.createElement('div');
            parentChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
            parentChevron.innerHTML = '<svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

            const parentMenu = document.createElement('div');
            parentMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-50 hidden max-h-60 overflow-y-auto';

            const relationOptions = ['New Relation'];
            relationOptions.forEach(function(option) {
                const menuItem = document.createElement('div');
                menuItem.className = 'px-3 py-2 text-xs text-white hover:bg-gray-600 cursor-pointer border-b border-gray-600 last:border-b-0';
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
            deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 transition-colors flex-shrink-0';
            deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
            deleteButton.addEventListener('click', function() {
                relationRow.remove();
                updateRelationsCount(labelElement);
            });

            parentRelationRow.appendChild(parentDropdown);
            parentRelationRow.appendChild(deleteButton);

            const roleInput = document.createElement('input');
            roleInput.type = 'text';
            roleInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
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
        addRelationButton.className = 'w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-md text-xs text-white transition-colors';
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
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Description';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        textarea.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none';
        textarea.placeholder = 'Unknown';
        textarea.rows = 3;
        fieldContainer.appendChild(textarea);

        return fieldContainer;
    }

    function createFixMeField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Fix Me';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        textarea.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none';
        textarea.placeholder = 'Unknown';
        textarea.rows = 3;
        fieldContainer.appendChild(textarea);

        return fieldContainer;
    }

    function createImageField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Image';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        input.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        input.placeholder = 'https://example.com/photo.jpg';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-colors';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createLastCheckedDateField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Last Checked Date';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        input.className = 'flex-1 bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        input.placeholder = 'YYYY-MM-DD';
        input.id = 'date-input-' + fieldId;
        inputWrapper.appendChild(input);

        const calendarIcon = document.createElement('button');
        calendarIcon.type = 'button';
        calendarIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-white hover:text-gray-200 transition-colors cursor-pointer';
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
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Mapillary Image ID';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        input.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        input.value = 'Unknown';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-colors';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createNoteField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Note';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        textarea.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all resize-y';
        textarea.value = 'Unknown';
        textarea.rows = 3;
        fieldContainer.appendChild(textarea);

        return fieldContainer;
    }

    function createPanoramaxImageIdField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Panoramax Image ID';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        input.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        input.value = 'Unknown';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-colors';
        externalLinkIcon.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>';
        inputWrapper.appendChild(externalLinkIcon);

        fieldContainer.appendChild(inputWrapper);

        return fieldContainer;
    }

    function createWebsiteField(fieldId) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
        fieldContainer.id = 'field-' + fieldId;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-2';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-white';
        label.textContent = 'Website';
        labelWrapper.appendChild(label);

        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'w-4 h-4 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors';
        infoIcon.innerHTML = '<svg class="w-2.5 h-2.5 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        labelWrapper.appendChild(infoIcon);

        header.appendChild(labelWrapper);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        input.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        input.value = 'https://example.com';
        inputWrapper.appendChild(input);

        const externalLinkIcon = document.createElement('button');
        externalLinkIcon.type = 'button';
        externalLinkIcon.className = 'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-colors cursor-pointer';
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
        multilingualSection.className = 'bg-gray-700 rounded-lg p-3 space-y-2.5';

        const headerRow = document.createElement('div');
        headerRow.className = 'flex items-center justify-between';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-xs font-medium text-white';
        labelSpan.textContent = 'Multilingual Name';
        headerRow.appendChild(labelSpan);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            multilingualSection.remove();
        });
        headerRow.appendChild(deleteButton);

        multilingualSection.appendChild(headerRow);

        const languageDropdown = document.createElement('div');
        languageDropdown.className = 'relative';

        const languageSelect = document.createElement('select');
        languageSelect.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all appearance-none cursor-pointer';
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
        languageChevron.innerHTML = '<svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        languageDropdown.appendChild(languageSelect);
        languageDropdown.appendChild(languageChevron);
        multilingualSection.appendChild(languageDropdown);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        nameInput.placeholder = 'Name';
        multilingualSection.appendChild(nameInput);

        const existingFieldsContainer = fieldsContainer.querySelector('.bg-gray-700.rounded-lg');
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
        container.className = 'border-b border-gray-700';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700 transition-colors group';
        button.setAttribute('data-menu-item', id);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-sm font-medium text-blue-400 group-hover:text-blue-300 transition-colors';
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
            folderContainer.className += ' bg-blue-500/20';
        } else if (label.includes('Barrier')) {
            folderContainer.className += ' bg-red-500/20';
        } else if (label.includes('Natural')) {
            folderContainer.className += ' bg-green-500/20';
        } else {
            folderContainer.className += ' bg-gray-500/20';
        }

        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('class', 'w-4 h-4');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'none');
        
        let strokeColor = '#9CA3AF';
        if (label.includes('Waterways')) {
            strokeColor = '#60A5FA';
        } else if (label.includes('Barrier')) {
            strokeColor = '#EF4444';
        } else if (label.includes('Natural')) {
            strokeColor = '#10B981';
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
        if (sidePanelContent) {
            const container = document.getElementById('lineDropdownsContainer');
            if (container) {
                container.style.display = 'none';
            }
            
            const searchResults = document.getElementById('featureSearchResults');
            if (searchResults) {
                searchResults.style.display = 'block';
            }
        }
    }

    function getCurrentLineId() {
        return currentLineId;
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
            item.className = 'w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-600 transition-colors first:rounded-t-lg last:rounded-b-lg';
            item.textContent = option.label || option;
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-value', option.value || option);

            item.addEventListener('click', function() {
                const selectedValue = option.label || option;
                
                if (!selectedValue) return;
                
                currentFeatureLabel = selectedValue;
                updateCurrentFeatureLabel(selectedValue);
                
                dropdownMenu.classList.add('hidden');
                dropdownMenu.setAttribute('data-selected-value', option.value || option);
                
                if (dropdownContainer) {
                    const dropdownButton = dropdownContainer.querySelector('button');
                    if (dropdownButton) {
                        const labelSpan = dropdownButton.querySelector('span');
                        if (labelSpan && dropdownLabel) {
                            labelSpan.textContent = dropdownLabel;
                        }
                    }
                }
                
                // Check if we're editing an approved line
                const approvedLineData = window.approvedLineBeingEdited || null;
                
                if (approvedLineData) {
                    // Update the approved line visualization on the map
                    if (approvedLineData.id) {
                        // Check if it's a Riyadh road
                        if (approvedLineData.is_riyadh_road) {
                            updateRiyadhRoadVisualization(approvedLineData.id, selectedValue, approvedLineData.geometry);
                        } else {
                            updateApprovedLineVisualization(approvedLineData.id, selectedValue);
                        }
                    }
                    
                    // Update side panel visualization if it's visible
                    const sidePanel = document.getElementById('editSidePanel');
                    const isSidePanelVisible = sidePanel && !sidePanel.classList.contains('-translate-x-full');
                    const svgContainer = document.getElementById('lineVisualizationSVG');
                    
                    if (isSidePanelVisible && svgContainer && approvedLineData.geometry) {
                        updateLineVisualizationFromGeometry(approvedLineData.geometry, selectedValue);
                    }
                    
                    // Preserve existing data when changing feature type
                    // Store current fields, tags, and relations data before showing edit screen
                    const existingFieldsData = approvedLineData.fields_data || {};
                    const existingTagsData = approvedLineData.tags_data || [];
                    const existingRelationsData = approvedLineData.relations_data || [];
                    
                    // Update the feature label in the stored data
                    const updatedLineData = Object.assign({}, approvedLineData, {
                        current_feature_label: selectedValue,
                        feature_type: selectedValue,
                        fields_data: existingFieldsData,
                        tags_data: existingTagsData,
                        relations_data: existingRelationsData
                    });
                    
                    // Update the stored approved line data
                    window.approvedLineBeingEdited = updatedLineData;
                    if (window.approvedLinesBeingEdited) {
                        window.approvedLinesBeingEdited[approvedLineData.id] = updatedLineData;
                    }
                    
                    // Show Edit Feature screen with updated feature label and preserved data
                    setTimeout(function() {
                        showEditFeatureScreen({
                            hideBackButton: false,
                            requestGeometry: approvedLineData.geometry,
                            lineData: updatedLineData,
                            isApprovedLine: true,
                            approvedLineId: approvedLineData.id
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

    /**
     * Update Riyadh road visualization on the map when feature type changes
     */
    function updateRiyadhRoadVisualization(roadId, newFeatureLabel, geometry) {
        if (typeof map === 'undefined' || !map) return;
        if (!geometry) return;
        
        const sourceId = 'riyadh-road-selected-source-' + roadId;
        const glowLayerId = 'riyadh-road-selected-glow-' + roadId;
        const layerId = 'riyadh-road-selected-layer-' + roadId;
        
        // Get visualization style based on new feature label
        let style;
        if (typeof getVisualizationStyle === 'function') {
            style = getVisualizationStyle(newFeatureLabel);
        } else {
            style = {
                lineColor: '#ffffff',
                glowColor: '#ef4444',
                lineWidth: 4,
                glowWidth: 10,
                glowOpacity: 0.5,
                markerColor: '#ffffff',
                markerGlowColor: '#ef4444'
            };
        }
        
        // Create or update source
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: geometry
                }
            });
        } else {
            map.getSource(sourceId).setData({
                type: 'Feature',
                geometry: geometry
            });
        }
        
        // Create or update glow layer
        if (!map.getLayer(glowLayerId)) {
            map.addLayer({
                id: glowLayerId,
                type: 'line',
                source: sourceId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': style.glowColor,
                    'line-width': style.glowWidth,
                    'line-opacity': style.glowOpacity
                }
            }, 'riyadh-roads-layer'); // Insert before riyadh-roads-layer
        } else {
            map.setPaintProperty(glowLayerId, 'line-color', style.glowColor);
            map.setPaintProperty(glowLayerId, 'line-width', style.glowWidth);
            map.setPaintProperty(glowLayerId, 'line-opacity', style.glowOpacity);
        }
        
        // Create or update main line layer
        if (!map.getLayer(layerId)) {
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': style.lineColor,
                    'line-width': style.lineWidth
                }
            }, glowLayerId); // Insert after glow layer
        } else {
            map.setPaintProperty(layerId, 'line-color', style.lineColor);
            map.setPaintProperty(layerId, 'line-width', style.lineWidth);
        }
    }

    /**
     * Update approved line visualization on the map when feature type changes
     */
    function updateApprovedLineVisualization(approvedLineId, newFeatureLabel) {
        if (typeof map === 'undefined' || !map) return;
        
        const featureId = 'approved-line-' + approvedLineId;
        const sourceId = 'approved-line-source-' + approvedLineId;
        const glowLayerId = 'approved-line-glow-' + approvedLineId;
        const layerId = 'approved-line-layer-' + approvedLineId;
        
        // Get the source to get the geometry
        if (!map.getSource(sourceId)) {
            return;
        }
        
        // Try to get geometry from stored approved line data first
        let geometry = null;
        let feature = null;
        
        if (window.approvedLineBeingEdited && window.approvedLineBeingEdited.id === approvedLineId) {
            geometry = window.approvedLineBeingEdited.geometry;
            feature = {
                geometry: geometry,
                type: 'Feature'
            };
        } else if (window.approvedLinesBeingEdited && window.approvedLinesBeingEdited[approvedLineId]) {
            geometry = window.approvedLinesBeingEdited[approvedLineId].geometry;
            feature = {
                geometry: geometry,
                type: 'Feature'
            };
        } else {
            // Fallback: try to get from source data
            const source = map.getSource(sourceId);
            const sourceData = source._data;
            
            if (sourceData) {
                // Handle both Feature and FeatureCollection
                if (sourceData.type === 'Feature') {
                    feature = sourceData;
                    geometry = sourceData.geometry;
                } else if (sourceData.type === 'FeatureCollection' && sourceData.features && sourceData.features.length > 0) {
                    feature = sourceData.features[0];
                    geometry = feature.geometry;
                } else if (sourceData.features && sourceData.features.length > 0) {
                    // Handle case where it's stored as features array directly
                    feature = sourceData.features[0];
                    geometry = feature.geometry;
                }
            }
        }
        
        // Get new visualization style - use local function
        let style;
        if (typeof getVisualizationStyle === 'function') {
            style = getVisualizationStyle(newFeatureLabel);
        } else {
            // Default style
            style = {
                lineColor: '#ffffff',
                glowColor: '#ef4444',
                lineWidth: 4,
                glowWidth: 10,
                glowOpacity: 0.5,
                markerColor: '#ffffff',
                markerGlowColor: '#ef4444'
            };
        }
        
        // Update glow layer
        if (map.getLayer(glowLayerId)) {
            map.setPaintProperty(glowLayerId, 'line-color', style.glowColor);
            map.setPaintProperty(glowLayerId, 'line-width', style.glowWidth);
            map.setPaintProperty(glowLayerId, 'line-opacity', style.glowOpacity);
        }
        
        // Update main line layer
        if (map.getLayer(layerId)) {
            map.setPaintProperty(layerId, 'line-color', style.lineColor);
            map.setPaintProperty(layerId, 'line-width', style.lineWidth);
        }
        
        // Update vertex markers - only if we have geometry
        if (feature && geometry && geometry.type === 'LineString' && geometry.coordinates) {
            // Remove all existing markers for this line
            geometry.coordinates.forEach(function(coord, index) {
                const markerId = 'approved-marker-' + approvedLineId + '-' + index;
                const existingMarker = document.getElementById(markerId);
                if (existingMarker) {
                    existingMarker.remove();
                }
            });
            
            // Vertex markers for approved lines have been removed; the
            // updated symbology is now represented purely by the line
            // styling on the map layer.
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
        addMultilingualNameField: addMultilingualNameField
    };
    
    window.addFieldToContainer = addFieldToContainer;
    window.updateAddFieldDisplay = updateAddFieldDisplay;
    window.addMultilingualNameField = addMultilingualNameField;
    
    window.getCurrentLineId = getCurrentLineId;
    window.getCurrentFeatureLabel = getCurrentFeatureLabel;
    window.getDrawInstance = function() { return drawInstance; };
    window.getVisualizationStyle = getVisualizationStyle;
    window.updateFeatureTypeVisualization = updateFeatureTypeVisualization;
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

    /**
     * Show Riyadh road as LINE feature in sidebar
     * This integrates Riyadh roads with the LINE feature system
     */
    function showRiyadhRoadAsLineFeature(lineFeatureData) {
        if (!lineFeatureData) {
            return;
        }

        // Store the Riyadh road data for editing/saving
        if (!window.approvedLinesBeingEdited) {
            window.approvedLinesBeingEdited = {};
        }
        
        // Use a unique ID if the road has an ID, otherwise generate one
        const roadId = lineFeatureData.id || 'riyadh-road-' + Date.now();
        window.approvedLinesBeingEdited[roadId] = lineFeatureData;
        window.approvedLineBeingEdited = lineFeatureData;

        // Create visualization on map for the selected Riyadh road
        if (lineFeatureData.geometry && typeof map !== 'undefined' && map) {
            const featureLabel = lineFeatureData.current_feature_label || lineFeatureData.feature_type || 'Line';
            updateRiyadhRoadVisualization(roadId, featureLabel, lineFeatureData.geometry);
        }

        // Use the same mechanism as approved lines since format is compatible
        // The showApprovedLineDetails function from load-approved-lines.js should handle this
        if (typeof window.showApprovedLineDetails === 'function') {
            try {
                window.showApprovedLineDetails(lineFeatureData, true);
            } catch (error) {
                // Fallback to direct sidebar opening
                openSidebarDirectly(lineFeatureData);
            }
        } else {
            // Fallback: Use showLineSidePanelForApprovedLineEdit
            const featureLabel = lineFeatureData.current_feature_label || lineFeatureData.feature_type || 'Line';
            showLineSidePanelForApprovedLineEdit(featureLabel);
            
            // Populate fields and tags after sidebar is ready
            setTimeout(function() {
                if (lineFeatureData.fields_data && typeof window.populateFieldsDataForApprovedLine === 'function') {
                    window.populateFieldsDataForApprovedLine(lineFeatureData.fields_data);
                }
                if (lineFeatureData.tags_data && typeof window.populateTagsDataForApprovedLine === 'function') {
                    window.populateTagsDataForApprovedLine(lineFeatureData.tags_data);
                }
            }, 400);
        }
    }
    
    /**
     * Directly open sidebar and show edit feature screen (fallback method)
     */
    function openSidebarDirectly(lineFeatureData) {
        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) {
            return;
        }
        
        // Force open sidebar
        sidePanel.classList.remove('-translate-x-full');
        sidePanel.style.display = '';
        sidePanel.style.visibility = 'visible';
        sidePanel.style.opacity = '1';
        sidePanel.style.setProperty('transform', 'translateX(0)', 'important');
        
        // Adjust map container
        const mapContainer = document.getElementById('mapContainer');
        if (mapContainer) {
            const SIDE_PANEL_WIDTH = 320;
            mapContainer.style.marginLeft = SIDE_PANEL_WIDTH + 'px';
            mapContainer.style.width = `calc(100% - ${SIDE_PANEL_WIDTH}px)`;
            
            setTimeout(function() {
                if (map && map.resize) {
                    map.resize();
                }
            }, 300);
        }
        
        // Show edit feature screen directly
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showEditFeatureScreen === 'function') {
            const featureLabel = lineFeatureData.current_feature_label || lineFeatureData.feature_type || 'Line';
            window.lineDrawingHandler.showEditFeatureScreen({
                hideBackButton: false,
                requestGeometry: lineFeatureData.geometry,
                lineData: lineFeatureData,
                isApprovedLine: true,
                approvedLineId: lineFeatureData.id
            });
            
            // Populate data after a delay
            setTimeout(function() {
                if (lineFeatureData.fields_data && typeof window.populateFieldsDataForApprovedLine === 'function') {
                    window.populateFieldsDataForApprovedLine(lineFeatureData.fields_data);
                }
                if (lineFeatureData.tags_data && typeof window.populateTagsDataForApprovedLine === 'function') {
                    window.populateTagsDataForApprovedLine(lineFeatureData.tags_data);
                }
            }, 500);
        }
    }

    // Expose function globally
    window.showRiyadhRoadAsLineFeature = showRiyadhRoadAsLineFeature;
    if (window.lineDrawingHandler) {
        window.lineDrawingHandler.showRiyadhRoadAsLineFeature = showRiyadhRoadAsLineFeature;
    }
})();
