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
        } catch (error) {
            console.error('Line drawing: Error initializing', error);
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
                console.debug('Line drawing: Error monitoring drawing', e);
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
            console.debug('Line drawing: Could not hide default rendering', e);
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
            console.debug('Line drawing: Could not setup SVG observer', e);
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
                console.debug('Line drawing: Error in drawing monitor', e);
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
                            console.debug('Line drawing: Could not set select mode', e);
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
            console.error('Line drawing: Error handling line drawn', error);
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
            updateCurrentFeatureLabel('Line');

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
            console.error('Line drawing: Error selecting line', error);
            selectedLineId = id;
            currentLineId = id;
            updateCurrentFeatureLabel('Line');
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
        if (!drawInstance) return;

        try {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === id; });

            if (feature && feature.geometry) {
                if (feature.geometry.type === 'LineString') {
                    selectedLineId = id;
                    currentLineId = id;
                    
                    hideDefaultRendering();
                    renderLineAsMapLibreLayer(id);
                    applyGlowingEffect(id);
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
            console.error('Line drawing: Error handling feature selection', error);
        }
    }

    function handleFeatureDeselected() {
        if (selectedLineId) {
            removeMapLibreLineLayer(selectedLineId);
        }
        
        selectedLineId = null;
        currentLineId = null;
        clearVertexMarkers();
        
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

    function showLineSidePanel() {
        if (!sidePanelContent) {
            setTimeout(showLineSidePanel, 100);
            return;
        }

        const searchResults = document.getElementById('featureSearchResults');
        if (searchResults) {
            searchResults.style.display = 'none';
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

        const labelText = document.createElement('div');
        labelText.className = 'text-xs font-medium text-gray-400 mb-2';
        labelText.textContent = 'Current Feature';
        container.appendChild(labelText);

        const valueDisplay = document.createElement('div');
        valueDisplay.id = 'lineVisualizationFeatureName';
        valueDisplay.className = 'text-sm font-semibold text-white mb-3';
        valueDisplay.textContent = 'Line';
        container.appendChild(valueDisplay);

        const svgContainer = document.createElement('div');
        svgContainer.id = 'lineVisualizationSVG';
        svgContainer.className = 'relative w-full';
        svgContainer.style.height = '200px';
        svgContainer.style.backgroundColor = '#1f2937';
        svgContainer.style.borderRadius = '4px';
        svgContainer.style.overflow = 'hidden';
        container.appendChild(svgContainer);

        return container;
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

            const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            glowPath.setAttribute('d', pathData);
            glowPath.setAttribute('fill', 'none');
            glowPath.setAttribute('stroke', '#ef4444');
            glowPath.setAttribute('stroke-width', '10');
            glowPath.setAttribute('stroke-opacity', '0.5');
            glowPath.setAttribute('filter', 'url(#blur)');
            glowPath.setAttribute('stroke-linecap', 'round');
            glowPath.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(glowPath);

            const mainPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            mainPath.setAttribute('d', pathData);
            mainPath.setAttribute('fill', 'none');
            mainPath.setAttribute('stroke', '#ffffff');
            mainPath.setAttribute('stroke-width', '4');
            mainPath.setAttribute('stroke-opacity', '1');
            mainPath.setAttribute('stroke-linecap', 'round');
            mainPath.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(mainPath);

            coordinates.forEach(function(coord, index) {
                const x = coord[0] * scale + offsetX;
                const y = -coord[1] * scale + offsetY;

                const markerGlow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                markerGlow.setAttribute('cx', x.toString());
                markerGlow.setAttribute('cy', y.toString());
                markerGlow.setAttribute('r', '8');
                markerGlow.setAttribute('fill', '#ef4444');
                markerGlow.setAttribute('opacity', '0.6');
                markerGlow.setAttribute('filter', 'url(#blur)');
                svg.appendChild(markerGlow);

                const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                marker.setAttribute('cx', x.toString());
                marker.setAttribute('cy', y.toString());
                marker.setAttribute('r', '6');
                marker.setAttribute('fill', '#ffffff');
                marker.setAttribute('stroke', '#ffffff');
                marker.setAttribute('stroke-width', '2');
                svg.appendChild(marker);
            });

            svgContainer.innerHTML = '';
            svgContainer.appendChild(svg);

        } catch (e) {
            console.error('Error updating line visualization:', e);
        }
    }

    function updateCurrentFeatureLabel(featureType) {
        const valueDisplay = document.getElementById('currentFeatureValue');
        if (valueDisplay) {
            valueDisplay.textContent = featureType || 'Line';
        }
        
        const visualizationFeatureName = document.getElementById('lineVisualizationFeatureName');
        if (visualizationFeatureName) {
            visualizationFeatureName.textContent = featureType || 'Line';
        }
    }

    function clearVertexMarkers() {
        vertexMarkers.forEach(function(marker) {
            try {
                marker.remove();
            } catch (e) {
                console.debug('Error removing marker', e);
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
            
            const existingSource = map.getSource(sourceId);
            if (existingSource && existingSource.setData) {
                try {
                    existingSource.setData({
                        type: 'FeatureCollection',
                        features: [feature]
                    });
                    hideDefaultRendering();
                    return;
                } catch (e) {
                    console.debug('Line drawing: Could not update source, recreating', e);
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
                console.debug('Line drawing: Could not remove existing layers', e);
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
                    'line-color': '#ef4444',
                    'line-width': 10,
                    'line-opacity': 0.5,
                    'line-blur': 6
                }
            });
            
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 4,
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
            console.error('Error rendering line as MapLibre layer:', e);
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
            console.error('Error removing MapLibre line layer:', e);
        }
    }

    function forceMarkersVisibility() {
        if (typeof map === 'undefined' || !map || !drawInstance || !currentLineId) return;
        
        try {
            const snapshot = drawInstance.getSnapshot();
            const feature = snapshot?.find(function(f) { return f.id === currentLineId; });
            
            if (!feature || !feature.geometry || feature.geometry.type !== 'LineString') {
                return;
            }

            const coordinates = feature.geometry.coordinates;
            if (!coordinates || coordinates.length < 2) return;

            clearVertexMarkers();

            coordinates.forEach(function(coord, index) {
                const el = document.createElement('div');
                el.className = 'vertex-marker';
                el.style.width = '12px';
                el.style.height = '12px';
                el.style.borderRadius = '50%';
                el.style.backgroundColor = '#ffffff';
                el.style.border = '2px solid #ffffff';
                el.style.boxShadow = '0 0 4px rgba(239, 68, 68, 0.8), 0 0 8px rgba(239, 68, 68, 0.6)';
                el.style.pointerEvents = 'none';
                el.style.zIndex = '1000';
                el.setAttribute('data-vertex-index', index.toString());
                el.setAttribute('data-line-id', currentLineId);

                const marker = new maplibregl.Marker({
                    element: el,
                    anchor: 'center'
                })
                .setLngLat([coord[0], coord[1]])
                .addTo(map);

                vertexMarkers.push(marker);
            });

            const updateMarkers = function() {
                const updatedSnapshot = drawInstance.getSnapshot();
                const updatedFeature = updatedSnapshot?.find(function(f) { return f.id === currentLineId; });
                if (updatedFeature && updatedFeature.geometry && updatedFeature.geometry.type === 'LineString') {
                    const updatedCoords = updatedFeature.geometry.coordinates;
                    if (updatedCoords && updatedCoords.length === vertexMarkers.length) {
                        vertexMarkers.forEach(function(marker, index) {
                            if (index < updatedCoords.length) {
                                marker.setLngLat([updatedCoords[index][0], updatedCoords[index][1]]);
                            }
                        });
                    }
                }
            };

            if (map._lineMarkerUpdater) {
                map.off('move', map._lineMarkerUpdater);
                map.off('zoom', map._lineMarkerUpdater);
            }

            map._lineMarkerUpdater = updateMarkers;
            map.on('move', updateMarkers);
            map.on('zoom', updateMarkers);
        } catch (e) {
            console.debug('Line drawing: Error forcing markers visibility', e);
        }
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

        options.forEach(function(option) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-600 transition-colors first:rounded-t-lg last:rounded-b-lg';
            item.textContent = option.label || option;
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-value', option.value || option);

            item.addEventListener('click', function() {
                const selectedValue = option.label || option;
                updateCurrentFeatureLabel(selectedValue);
                dropdownMenu.classList.add('hidden');
                dropdownMenu.setAttribute('data-selected-value', option.value || option);
            });

            dropdownMenu.appendChild(item);
        });
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
        updateDropdownData: updateDropdownData,
        updateCurrentFeatureLabel: updateCurrentFeatureLabel
    };
})();
