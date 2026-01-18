/**
 * Load and manage approved lines on the map
 */

(function() {
    'use strict';

    /**
     * Get cookie value by name
     */
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

    /**
     * Get user role from URL path
     */
    function getUserRole() {
        const path = window.location.pathname;
        if (path.includes('/manager/')) {
            return 'manager';
        } else if (path.includes('/editor/')) {
            return 'editor';
        } else if (path.includes('/system_admin/')) {
            return 'system_admin';
        }
        return null;
    }

    /**
     * Check if edit mode is enabled
     */
    function isEditModeEnabled() {
        const editButton = document.getElementById('editButton');
        const editToolbar = document.getElementById('editToolbar');
        
        // Check if edit button is active (not disabled and possibly has active state)
        if (editButton && !editButton.disabled) {
            // Check if toolbar is visible (indicates edit mode is active)
            if (editToolbar && editToolbar.style.display !== 'none') {
                return true;
            }
            // Check if edit button text indicates active state
            const buttonText = editButton.querySelector('span');
            if (buttonText && buttonText.textContent.toLowerCase().includes('exit')) {
                return true;
            }
        }
        
        // Fallback: check if side panel has edit-related content visible
        const sidePanel = document.getElementById('editSidePanel');
        if (sidePanel && !sidePanel.classList.contains('-translate-x-full')) {
            const editScreen = document.getElementById('editFeatureScreen');
            if (editScreen) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Clear all existing approved lines from the map
     */
    function clearAllApprovedLines() {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        
        const layersToRemove = [];
        const sourcesToRemove = [];
        
        // Get layers from style
        try {
            const allLayers = map.getStyle().layers || [];
            allLayers.forEach(function(layer) {
                if (layer.id && (layer.id.startsWith('approved-line-layer-') || layer.id.startsWith('approved-line-glow-'))) {
                    layersToRemove.push(layer.id);
                }
            });
        } catch (e) {
            // Style not loaded yet
        }
        
        // Get sources from style
        try {
            const allSources = Object.keys(map.getStyle().sources || {});
            allSources.forEach(function(sourceId) {
                if (sourceId.startsWith('approved-line-source-')) {
                    sourcesToRemove.push(sourceId);
                }
            });
        } catch (e) {
            // Style not loaded yet
        }
        
        // Check stored data for additional layer IDs
        if (window.approvedLinesData) {
            Object.keys(window.approvedLinesData).forEach(function(key) {
                const match = key.match(/approved-line-(?:layer|glow)-(\d+)/);
                if (match) {
                    const lineId = match[1];
                    const layerId = 'approved-line-layer-' + lineId;
                    const glowLayerId = 'approved-line-glow-' + lineId;
                    const sourceId = 'approved-line-source-' + lineId;
                    
                    if (layersToRemove.indexOf(layerId) === -1) {
                        layersToRemove.push(layerId);
                    }
                    if (layersToRemove.indexOf(glowLayerId) === -1) {
                        layersToRemove.push(glowLayerId);
                    }
                    if (sourcesToRemove.indexOf(sourceId) === -1) {
                        sourcesToRemove.push(sourceId);
                    }
                }
            });
        }
        
        // Direct check for layers that might exist but aren't in style
        for (let i = 1; i <= 200; i++) {
            const testLayerId = 'approved-line-layer-' + i;
            const testGlowLayerId = 'approved-line-glow-' + i;
            const testSourceId = 'approved-line-source-' + i;
            
            try {
                if (map.getLayer(testLayerId) && layersToRemove.indexOf(testLayerId) === -1) {
                    layersToRemove.push(testLayerId);
                }
            } catch (e) {
                // Layer doesn't exist
            }
            
            try {
                if (map.getLayer(testGlowLayerId) && layersToRemove.indexOf(testGlowLayerId) === -1) {
                    layersToRemove.push(testGlowLayerId);
                }
            } catch (e) {
                // Layer doesn't exist
            }
            
            try {
                if (map.getSource(testSourceId) && sourcesToRemove.indexOf(testSourceId) === -1) {
                    sourcesToRemove.push(testSourceId);
                }
            } catch (e) {
                // Source doesn't exist
            }
        }
        
        // Remove layers
        layersToRemove.forEach(function(layerId) {
            try {
                if (map.getLayer(layerId)) {
                    map.removeLayer(layerId);
                }
            } catch (e) {
                // Layer might not exist
            }
        });
        
        // Remove sources
        sourcesToRemove.forEach(function(sourceId) {
            try {
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch (e) {
                // Source might not exist
            }
        });
        
        // Clear stored data
        window.approvedLinesData = {};
    }

    /**
     * Load approved lines from server
     */
    function loadApprovedLines() {
        if (typeof map === 'undefined' || !map) {
            setTimeout(loadApprovedLines, 100);
            return;
        }

        clearAllApprovedLines();

        fetch('/mapping/api/approved-lines/', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            if (data.success && data.lines) {
                data.lines.forEach(function(lineData, index) {
                    renderApprovedLine(lineData);
                });
            }
        })
        .catch(function(error) {
            // Error loading approved lines
        });
    }

    /**
     * Render a single approved line on the map
     */
    function renderApprovedLine(lineData) {
        if (!lineData || !lineData.geometry || !lineData.id) {
            return;
        }

        const lineId = lineData.id;
        const layerId = 'approved-line-layer-' + lineId;
        const glowLayerId = 'approved-line-glow-' + lineId;
        const sourceId = 'approved-line-source-' + lineId;

        // Determine feature label for styling
        const featureLabel = lineData.current_feature_label || lineData.feature_type || 'Line';

        // Get visualization style
        let style = null;
        if (typeof window.getVisualizationStyle === 'function') {
            style = window.getVisualizationStyle(featureLabel);
        } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getVisualizationStyle === 'function') {
            style = window.lineDrawingHandler.getVisualizationStyle(featureLabel);
        }

        if (!style) {
            // Fallback to default style
            style = {
                lineColor: '#ffffff',
                glowColor: '#ef4444',
                lineWidth: 4,
                glowWidth: 10,
                glowOpacity: 0.5
            };
        }

        // Create GeoJSON feature
        const feature = {
            type: 'Feature',
            geometry: lineData.geometry,
            properties: {
                id: lineId,
                feature_type: featureLabel
            }
        };

        const featureCollection = {
            type: 'FeatureCollection',
            features: [feature]
        };

        // Remove existing layers and source if they exist
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
            // Layers/sources don't exist yet
        }

        // Add source
        map.addSource(sourceId, {
            type: 'geojson',
            data: featureCollection
        });

        // Add glow layer
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
                'line-opacity': style.glowOpacity || 0.5
            }
        });

        // Add main line layer
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
                'line-width': style.lineWidth,
                'line-opacity': 1
            }
        });

        // Store line data for reference
        if (!window.approvedLinesData) {
            window.approvedLinesData = {};
        }
        window.approvedLinesData[layerId] = {
            id: lineId,
            geometry: lineData.geometry,
            feature_type: featureLabel,
            current_feature_label: featureLabel,
            fields_data: lineData.fields_data || {},
            tags_data: lineData.tags_data || [],
            relations_data: lineData.relations_data || []
        };

        // Add click and hover handlers
        map.on('click', layerId, function(e) {
            showApprovedLineDetails(lineData, true);
        });

        map.on('mouseenter', layerId, function() {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', layerId, function() {
            map.getCanvas().style.cursor = '';
        });
    }

    /**
     * Show approved line details in side panel
     */
    function showApprovedLineDetails(lineData, isClick) {
        if (!lineData) {
            return;
        }

        const sidePanel = document.getElementById('editSidePanel');
        if (!sidePanel) {
            return;
        }

        // Always open side panel (works in both edit mode and view mode)
        // Remove the translate class to show it, regardless of edit mode state
        sidePanel.classList.remove('-translate-x-full');
        sidePanel.style.display = ''; // Ensure it's not hidden
        sidePanel.style.visibility = 'visible'; // Ensure visibility
        sidePanel.style.opacity = '1'; // Ensure opacity
        
        // Force show with important styles if needed
        sidePanel.style.setProperty('transform', 'translateX(0)', 'important');
        
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

        // Update feature label
        const featureLabelToUse = lineData.current_feature_label || lineData.feature_type || 'Line';
        
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
            window.lineDrawingHandler.updateCurrentFeatureLabel(featureLabelToUse);
        } else if (typeof window.updateCurrentFeatureLabel === 'function') {
            window.updateCurrentFeatureLabel(featureLabelToUse);
        }

        // Determine if back button should be shown
        // For Riyadh roads, always show back button (view mode by default)
        const isRiyadhRoad = lineData && lineData.is_riyadh_road;
        const userRole = getUserRole();
        const editModeEnabled = isEditModeEnabled();
        let shouldHideBackButton = true;
        
        if (isRiyadhRoad) {
            // Riyadh roads: always show back button to allow returning to select feature screen
            shouldHideBackButton = false;
        } else if (userRole === 'manager') {
            shouldHideBackButton = true;
        } else if (userRole === 'editor' || userRole === 'system_admin') {
            shouldHideBackButton = !editModeEnabled;
        } else {
            shouldHideBackButton = !editModeEnabled;
        }
        
        // Store line data for editing (including Riyadh roads)
        if (lineData && (isRiyadhRoad || userRole === 'editor' || userRole === 'system_admin')) {
            if (!window.approvedLinesBeingEdited) {
                window.approvedLinesBeingEdited = {};
            }
            window.approvedLinesBeingEdited[lineData.id] = lineData;
            window.approvedLineBeingEdited = lineData;
        }
        
        // Show edit feature screen
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showEditFeatureScreen === 'function') {
            window.lineDrawingHandler.showEditFeatureScreen({
                hideBackButton: shouldHideBackButton,
                requestGeometry: lineData.geometry,
                lineData: lineData,
                isApprovedLine: true,
                approvedLineId: lineData.id
            });
        }

        // Wait for edit screen to be created, then populate data
        setTimeout(function() {
            const editScreen = document.getElementById('editFeatureScreen');
            if (editScreen && lineData) {
                editScreen.setAttribute('data-request-geometry', JSON.stringify(lineData.geometry));
                editScreen.setAttribute('data-line-id', lineData.id.toString());

                // Update visualization
                setTimeout(function() {
                    const featureLabel = lineData.current_feature_label || lineData.feature_type || 'Line';
                    
                    if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
                        window.lineDrawingHandler.updateCurrentFeatureLabel(featureLabel);
                    }
                    
                    if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateFeatureTypeLabelDisplay === 'function') {
                        window.lineDrawingHandler.updateFeatureTypeLabelDisplay();
                    }
                    
                    setTimeout(function() {
                        if (typeof window.updateFeatureTypeVisualization === 'function') {
                            window.updateFeatureTypeVisualization();
                        } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateFeatureTypeVisualization === 'function') {
                            window.lineDrawingHandler.updateFeatureTypeVisualization();
                        }
                    }, 50);
                }, 100);

                // Populate fields, tags, and relations
                // Try using manager-requests.js functions first (if available for managers),
                // otherwise use our local functions (for editors/system admins)
                if (lineData.fields_data) {
                    setTimeout(function() {
                        if (typeof window.populateFieldsData === 'function') {
                            // Use manager-requests.js function if available
                            window.populateFieldsData(lineData.fields_data);
                        } else if (typeof window.populateFieldsDataForApprovedLine === 'function') {
                            // Use our local function for editors/system admins
                            window.populateFieldsDataForApprovedLine(lineData.fields_data);
                        }
                    }, 300);
                }

                if (lineData.tags_data) {
                    setTimeout(function() {
                        if (typeof window.populateTagsData === 'function') {
                            // Use manager-requests.js function if available
                            window.populateTagsData(lineData.tags_data);
                        } else if (typeof window.populateTagsDataForApprovedLine === 'function') {
                            // Use our local function for editors/system admins
                            window.populateTagsDataForApprovedLine(lineData.tags_data);
                        }
                    }, 350);
                }

                if (lineData.relations_data) {
                    setTimeout(function() {
                        if (typeof window.populateRelationsData === 'function') {
                            // Use manager-requests.js function if available
                            window.populateRelationsData(lineData.relations_data);
                        } else if (typeof window.populateRelationsDataForApprovedLine === 'function') {
                            // Use our local function for editors/system admins
                            window.populateRelationsDataForApprovedLine(lineData.relations_data);
                        }
                    }, 400);
                }
            }
        }, 200);
    }

    // Initialize when map is ready
    if (typeof map !== 'undefined' && map) {
        map.on('load', function() {
            loadApprovedLines();
        });
    } else {
        // Wait for map to be available
        const checkMap = setInterval(function() {
            if (typeof map !== 'undefined' && map) {
                clearInterval(checkMap);
                map.on('load', function() {
                    loadApprovedLines();
                });
                if (map.loaded()) {
                    loadApprovedLines();
                }
            }
        }, 100);
    }

    /**
     * Populate fields data for approved line
     */
    function populateFieldsDataForApprovedLine(fieldsData) {
        const fieldsContainer = document.getElementById('fields-container');
        if (!fieldsContainer || !fieldsData) return;

        // Populate Name field
        // The structure: .bg-gray-700.rounded-lg contains:
        // 1. createFieldItem('Name') - which is just a label div (NOT an input)
        // 2. commonNameInput - which is an input for common name
        // The name input is MISSING from the structure! We need to find or create it
        const nameFieldContainer = fieldsContainer.querySelector('.bg-gray-700.rounded-lg');
        if (nameFieldContainer) {
            const nameFieldLabel = nameFieldContainer.querySelector('.flex.items-center.justify-between');
            
            // Try to find existing name input
            let nameInput = nameFieldContainer.querySelector('input[type="text"][placeholder*="Name"]');
            
            // If not found, look for first input (might be name input)
            if (!nameInput) {
                const allInputs = nameFieldContainer.querySelectorAll('input[type="text"]');
                // Check if first input is name (comes before commonNameInput)
                if (allInputs.length > 0) {
                    const firstInput = allInputs[0];
                    // If it doesn't have a specific placeholder and is the first input, assume it's name
                    if (!firstInput.placeholder || firstInput.placeholder === '') {
                        nameInput = firstInput;
                    }
                }
            }
            
            // If still not found and we need to populate name, create the input
            if (!nameInput && nameFieldLabel && fieldsData.hasOwnProperty('name')) {
                // Create name input and insert it right after the Name label
                nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
                nameInput.placeholder = 'Name';
                
                // Insert after nameFieldLabel (before any other inputs)
                if (nameFieldLabel.nextSibling) {
                    nameFieldContainer.insertBefore(nameInput, nameFieldLabel.nextSibling);
                } else {
                    nameFieldContainer.appendChild(nameInput);
                }
            }
            
            // Set the value if input exists
            if (nameInput && fieldsData.hasOwnProperty('name')) {
                nameInput.value = fieldsData.name || '';
            }
        }

        // Populate Common name field (second input in the first container)
        const commonNameInput = fieldsContainer.querySelector('.bg-gray-700.rounded-lg input[type="text"]:not([placeholder*="Name"])');
        if (commonNameInput && fieldsData.common_name) {
            commonNameInput.value = fieldsData.common_name;
        }

        // Populate Multilingual names
        if (fieldsData.multilingual_names && Array.isArray(fieldsData.multilingual_names)) {
            fieldsData.multilingual_names.forEach(function(multilingual) {
                if (multilingual.language && multilingual.name) {
                    // Use addMultilingualNameField if available
                    if (typeof window.addMultilingualNameField === 'function') {
                        window.addMultilingualNameField(fieldsContainer);
                        // Get the last created multilingual section
                        setTimeout(function() {
                            const multilingualSections = fieldsContainer.querySelectorAll('[id^="multilingual-"]');
                            if (multilingualSections.length > 0) {
                                const multilingualSection = multilingualSections[multilingualSections.length - 1];
                                const languageSelect = multilingualSection.querySelector('select');
                                const nameInput = multilingualSection.querySelector('input[type="text"]');
                                if (languageSelect) languageSelect.value = multilingual.language;
                                if (nameInput) nameInput.value = multilingual.name;
                            }
                        }, 50);
                    }
                }
            });
        }

        // Populate other fields (Description, Fix Me, Image, etc.)
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
                    // Field doesn't exist, create it using addFieldToContainer if available
                    if (typeof window.addFieldToContainer === 'function') {
                        window.addFieldToContainer(fieldInfo.name, fieldId, fieldsContainer);
                        
                        // Add to selectedFields array
                        if (typeof window.selectedFields === 'undefined') {
                            window.selectedFields = [];
                        }
                        if (window.selectedFields.indexOf(fieldId) === -1) {
                            window.selectedFields.push(fieldId);
                        }
                        
                        // Wait a bit then populate the value
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
                    // Field exists, just populate the value
                    const input = existingField.querySelector('input, textarea');
                    if (input) {
                        input.value = fieldsData[fieldKey];
                    }
                }
            }
        });
        
        // Update the "Add field" display to show selected fields
        setTimeout(function() {
            if (typeof window.updateAddFieldDisplay === 'function') {
                window.updateAddFieldDisplay();
            }
        }, 200);
    }

    /**
     * Populate tags data for approved line
     */
    function populateTagsDataForApprovedLine(tagsData) {
        if (!Array.isArray(tagsData) || tagsData.length === 0) return;
        
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        const tagsLabel = document.getElementById('tags-label-span');
        
        if (!tagsRowsContainer || !tagsLabel) return;

        // Clear existing tags before populating to prevent duplication
        tagsRowsContainer.innerHTML = '';

        tagsData.forEach(function(tag) {
            if (tag.key || tag.value) {
                createTagRowForApprovedLine(tagsRowsContainer, tagsLabel, tag.key || '', tag.value || '');
            }
        });
    }

    /**
     * Create a tag row for approved line
     */
    function createTagRowForApprovedLine(container, labelElement, key, value) {
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
        leftInput.value = key;

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
                updateTagsCountForApprovedLine(labelElement);
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
        rightInput.value = value;

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 transition-colors flex-shrink-0';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            tagRow.remove();
            updateTagsCountForApprovedLine(labelElement);
        });

        tagRow.appendChild(leftDropdown);
        tagRow.appendChild(rightInput);
        tagRow.appendChild(deleteButton);
        container.appendChild(tagRow);
        updateTagsCountForApprovedLine(labelElement);
    }

    /**
     * Update tags count for approved line
     */
    function updateTagsCountForApprovedLine(labelElement) {
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        if (tagsRowsContainer && labelElement) {
            const tagRows = tagsRowsContainer.querySelectorAll('.flex.items-center.gap-2');
            const count = tagRows.length;
            labelElement.textContent = 'Tags (' + count + ')';
        }
    }

    /**
     * Populate relations data for approved line
     */
    function populateRelationsDataForApprovedLine(relationsData) {
        if (!Array.isArray(relationsData) || relationsData.length === 0) return;
        
        const relationsRowsContainer = document.getElementById('relations-rows-container');
        const relationsLabel = document.getElementById('relations-label-span');
        
        if (!relationsRowsContainer || !relationsLabel) return;

        relationsData.forEach(function(relation) {
            if (relation.parent_relation || relation.role) {
                createRelationRowForApprovedLine(relationsRowsContainer, relationsLabel, relation.parent_relation || 'New Relation', relation.role || '');
            }
        });
    }

    /**
     * Create a relation row for approved line
     */
    function createRelationRowForApprovedLine(container, labelElement, parentRelation, role) {
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
        parentInput.value = parentRelation;
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
            updateRelationsCountForApprovedLine(labelElement);
        });

        parentRelationRow.appendChild(parentDropdown);
        parentRelationRow.appendChild(deleteButton);

        const roleInput = document.createElement('input');
        roleInput.type = 'text';
        roleInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        roleInput.placeholder = 'Role';
        roleInput.value = role;

        relationRow.appendChild(parentRelationRow);
        relationRow.appendChild(roleInput);
        container.appendChild(relationRow);
        updateRelationsCountForApprovedLine(labelElement);
    }

    /**
     * Update relations count for approved line
     */
    function updateRelationsCountForApprovedLine(labelElement) {
        const relationsRowsContainer = document.getElementById('relations-rows-container');
        if (relationsRowsContainer && labelElement) {
            const relationRows = relationsRowsContainer.querySelectorAll('.space-y-2');
            const count = relationRows.length;
            labelElement.textContent = 'Relations (' + count + ')';
        }
    }

    // Expose reload function
    window.reloadApprovedLines = loadApprovedLines;
    
    // Expose showApprovedLineDetails for use by other scripts (e.g., map.js for Riyadh roads)
    window.showApprovedLineDetails = showApprovedLineDetails;
    
    // Expose populate functions
    window.populateFieldsDataForApprovedLine = populateFieldsDataForApprovedLine;
    window.populateTagsDataForApprovedLine = populateTagsDataForApprovedLine;
    window.populateRelationsDataForApprovedLine = populateRelationsDataForApprovedLine;

})();
