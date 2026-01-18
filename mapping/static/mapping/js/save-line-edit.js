/**
 * Save Line Edit Request Handler
 * Handles saving line edit requests from Editors and System Admins
 */

(function() {
    'use strict';

    let currentLineId = null;
    let drawInstance = null;
    let currentFeatureLabel = 'Line';

    /**
     * Get current line data from line-drawing.js
     */
    function getCurrentLineData() {
        if (typeof window.getCurrentLineId === 'function') {
            currentLineId = window.getCurrentLineId();
        } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentLineId === 'function') {
            currentLineId = window.lineDrawingHandler.getCurrentLineId();
        }
        
        if (typeof window.getCurrentFeatureLabel === 'function') {
            currentFeatureLabel = window.getCurrentFeatureLabel();
        } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentFeatureLabel === 'function') {
            currentFeatureLabel = window.lineDrawingHandler.getCurrentFeatureLabel();
        }
        
        if (typeof window.getDrawInstance === 'function') {
            drawInstance = window.getDrawInstance();
        } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getDrawInstance === 'function') {
            drawInstance = window.lineDrawingHandler.getDrawInstance();
        } else if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            drawInstance = draw.getTerraDrawInstance();
        }
    }

    /**
     * Collect fields data from the sidepanel
     */
    function collectFieldsData() {
        const fieldsData = {};
        const fieldsContainer = document.getElementById('fields-container');
        
        if (!fieldsContainer) {
            return fieldsData;
        }

        // Get Name field - it's in the first field item
        const nameFieldContainer = fieldsContainer.querySelector('.bg-gray-700.rounded-lg');
        if (nameFieldContainer) {
            const nameInput = nameFieldContainer.querySelector('input[type="text"]');
            if (nameInput && nameInput.placeholder && nameInput.placeholder.includes('Name')) {
                fieldsData.name = nameInput.value || '';
            }
        }

        // Get Common name field - it's the second input in the existing fields container
        const commonNameInput = fieldsContainer.querySelector('.bg-gray-700.rounded-lg input[type="text"]:not([placeholder*="Name"])');
        if (commonNameInput) {
            fieldsData.common_name = commonNameInput.value || '';
        }

        // Get Multilingual names
        const multilingualSections = fieldsContainer.querySelectorAll('[id^="multilingual-"]');
        fieldsData.multilingual_names = [];
        multilingualSections.forEach(function(section) {
            const languageSelect = section.querySelector('select');
            const nameInput = section.querySelector('input[type="text"]');
            if (languageSelect && nameInput && languageSelect.value && nameInput.value) {
                fieldsData.multilingual_names.push({
                    language: languageSelect.value,
                    name: nameInput.value
                });
            }
        });

        // Get all other fields by finding all elements with id starting with "field-"
        const allFieldContainers = fieldsContainer.querySelectorAll('[id^="field-"]');
        allFieldContainers.forEach(function(fieldContainer) {
            const fieldId = fieldContainer.id.replace('field-', '');
            const input = fieldContainer.querySelector('input, textarea');
            
            if (input) {
                let fieldKey = fieldId.replace(/-/g, '_');
                
                // Map field IDs to proper names
                const fieldNameMap = {
                    'description': 'description',
                    'fix-me': 'fix_me',
                    'image': 'image',
                    'last-checked-date': 'last_checked_date',
                    'mapillary-image-id': 'mapillary_image_id',
                    'note': 'note',
                    'panoramax-image-id': 'panoramax_image_id',
                    'website': 'website'
                };
                
                if (fieldNameMap[fieldId]) {
                    fieldsData[fieldNameMap[fieldId]] = input.value || '';
                } else {
                    fieldsData[fieldKey] = input.value || '';
                }
            }
        });

        return fieldsData;
    }

    /**
     * Collect tags data from the sidepanel
     */
    function collectTagsData() {
        const tagsData = [];
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        
        if (!tagsRowsContainer) {
            return tagsData;
        }

        const tagRows = tagsRowsContainer.querySelectorAll('.flex.items-center.gap-2');
        tagRows.forEach(function(row) {
            const keyInput = row.querySelector('input[readonly]');
            const valueInput = row.querySelector('input:not([readonly])');
            
            if (keyInput && valueInput && keyInput.value && valueInput.value) {
                tagsData.push({
                    key: keyInput.value,
                    value: valueInput.value
                });
            }
        });

        return tagsData;
    }

    /**
     * Collect relations data from the sidepanel
     */
    function collectRelationsData() {
        const relationsData = [];
        const relationsRowsContainer = document.getElementById('relations-rows-container');
        
        if (!relationsRowsContainer) {
            return relationsData;
        }

        // Relation rows have class 'space-y-2'
        const relationRows = relationsRowsContainer.querySelectorAll('.space-y-2');
        relationRows.forEach(function(row) {
            // Parent relation is in the first child (div with class 'flex items-center gap-2')
            const parentRow = row.querySelector('.flex.items-center.gap-2');
            const roleInput = row.querySelector('input[type="text"]:not([readonly])');
            
            let parentRelation = 'New Relation';
            if (parentRow) {
                const parentInput = parentRow.querySelector('input[readonly]');
                if (parentInput && parentInput.value) {
                    parentRelation = parentInput.value;
                }
            }
            
            if (roleInput && roleInput.value) {
                relationsData.push({
                    parent_relation: parentRelation,
                    role: roleInput.value
                });
            } else if (parentRelation !== 'New Relation') {
                // Include even if role is empty, as long as parent_relation is set
                relationsData.push({
                    parent_relation: parentRelation,
                    role: ''
                });
            }
        });

        return relationsData;
    }

    /**
     * Collect all line edit data
     */
    function collectLineEditData() {
        const editScreen = document.getElementById('editFeatureScreen');
        const isApprovedLineEdit = editScreen && editScreen.getAttribute('data-is-approved-line') === 'true';
        const approvedLineId = editScreen ? editScreen.getAttribute('data-approved-line-id') : null;
        
        let geometry = null;
        let featureLabelToUse = 'Line';
        
        // Check if this is a Riyadh road edit (not an approved line edit)
        const isRiyadhRoad = window.selectedRiyadhRoad || (window.approvedLineBeingEdited && window.approvedLineBeingEdited.is_riyadh_road);
        
        if (isApprovedLineEdit && approvedLineId && !isRiyadhRoad) {
            // This is an approved line edit (not a Riyadh road)
            const storedGeometry = editScreen.getAttribute('data-approved-line-geometry');
            if (storedGeometry) {
                try {
                    geometry = JSON.parse(storedGeometry);
                } catch (e) {
                    // Error parsing geometry from edit screen
                }
            }
            
            if (!geometry && window.approvedLinesData) {
                const approvedLineData = window.approvedLinesData['approved-line-layer-' + approvedLineId];
                if (approvedLineData && approvedLineData.geometry) {
                    geometry = approvedLineData.geometry;
                }
            }
            
            if (typeof window.getCurrentFeatureLabel === 'function') {
                featureLabelToUse = window.getCurrentFeatureLabel();
            } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentFeatureLabel === 'function') {
                featureLabelToUse = window.lineDrawingHandler.getCurrentFeatureLabel();
            } else if (window.approvedLineBeingEdited && window.approvedLineBeingEdited.current_feature_label) {
                featureLabelToUse = window.approvedLineBeingEdited.current_feature_label;
            } else if (window.approvedLineBeingEdited && window.approvedLineBeingEdited.feature_type) {
                featureLabelToUse = window.approvedLineBeingEdited.feature_type;
            }
        } else if (isRiyadhRoad || (window.approvedLineBeingEdited && window.approvedLineBeingEdited.geometry)) {
            // This is a Riyadh road edit - get geometry from stored data
            const riyadhRoadData = window.selectedRiyadhRoad || window.approvedLineBeingEdited;
            if (riyadhRoadData && riyadhRoadData.geometry) {
                geometry = riyadhRoadData.geometry;
                
                // Get feature label from stored data or current selection
                if (typeof window.getCurrentFeatureLabel === 'function') {
                    featureLabelToUse = window.getCurrentFeatureLabel();
                } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentFeatureLabel === 'function') {
                    featureLabelToUse = window.lineDrawingHandler.getCurrentFeatureLabel();
                } else if (riyadhRoadData.current_feature_label) {
                    featureLabelToUse = riyadhRoadData.current_feature_label;
                } else if (riyadhRoadData.feature_type) {
                    featureLabelToUse = riyadhRoadData.feature_type;
                }
            }
        } else {
            getCurrentLineData();
            
            if (!drawInstance || !currentLineId) {
                return null;
            }

            try {
                const snapshot = drawInstance.getSnapshot();
                const feature = snapshot?.find(function(f) { return f.id === currentLineId; });

                if (!feature || !feature.geometry || feature.geometry.type !== 'LineString') {
                    return null;
                }
                
                geometry = feature.geometry;
            } catch (error) {
                return null;
            }
            
            featureLabelToUse = currentFeatureLabel;
        }
        
        if (!geometry) {
            alert('Unable to get line geometry. Please try again.');
            return null;
        }

        // Don't set approved_line_id for Riyadh roads (they're from the backup, not approved lines)
        // isRiyadhRoad is already declared above, so just reuse it
        const approvedLineIdToUse = (isApprovedLineEdit && approvedLineId && !isRiyadhRoad) ? approvedLineId : null;
        
        return {
            geometry: geometry,
            feature_type: featureLabelToUse,
            current_feature_label: featureLabelToUse,
            fields_data: collectFieldsData(),
            tags_data: collectTagsData(),
            relations_data: collectRelationsData(),
            approved_line_id: approvedLineIdToUse
        };
    }

    /**
     * Show confirmation popup
     */
    function showSaveConfirmationPopup(isAutoApproved) {
        const popup = document.createElement('div');
        popup.id = 'saveConfirmationPopup';
        popup.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
        
        const title = isAutoApproved ? 'Edit Saved Successfully' : 'Edit Request Sent';
        const message = isAutoApproved 
            ? 'Your edit has been saved and will appear on the map after reload.'
            : 'Your requested edit has been sent to Manager and will be approved/rejected accordingly.';
        
        popup.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                <div class="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full">
                    <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </div>
                <h3 class="text-lg font-semibold text-gray-900 text-center mb-2">${title}</h3>
                <p class="text-sm text-gray-600 text-center mb-6">
                    ${message}
                </p>
                <button id="closeConfirmationPopup" class="w-full px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium">
                    OK
                </button>
            </div>
        `;

        document.body.appendChild(popup);

        const closeBtn = popup.querySelector('#closeConfirmationPopup');
        closeBtn.addEventListener('click', function() {
            popup.remove();
        });

        popup.addEventListener('click', function(e) {
            if (e.target === popup) {
                popup.remove();
            }
        });
    }

    /**
     * Handle save button click
     */
    function handleSave() {
        // Prevent duplicate calls
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn && saveBtn.disabled) {
            return; // Already processing
        }

        const editData = collectLineEditData();

        if (!editData) {
            alert('Please draw a line first before saving.');
            return;
        }

        // Show loading state
        if (saveBtn) {
            saveBtn.disabled = true;
            const originalText = saveBtn.querySelector('span').textContent;
            saveBtn.querySelector('span').textContent = 'Saving...';
        }

        // Send to backend
        fetch('/mapping/api/save-line-edit/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(editData)
        })
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            if (data.success) {
                const isAutoApproved = data.auto_approved || false;
                showSaveConfirmationPopup(isAutoApproved);
                
                if (isAutoApproved) {
                    setTimeout(function() {
                        window.location.reload();
                    }, 1500);
                } else {
                    // For editors/system admins, clear the visual representation
                    try {
                        if (currentLineId && typeof window.removeMapLibreLineLayer === 'function') {
                            window.removeMapLibreLineLayer(currentLineId);
                        }
                        if (typeof window.clearVertexMarkers === 'function') {
                            window.clearVertexMarkers();
                        }
                    } catch (e) {
                        // Error clearing visualization
                    }
                }
            } else {
                alert('Error: ' + (data.message || 'Failed to save edit request'));
            }
        })
        .catch(function(error) {
            alert('Error saving edit request. Please try again.');
        })
        .finally(function() {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.querySelector('span').textContent = 'Save';
            }
        });
    }

    /**
     * Get CSRF token from cookies
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
     * Initialize save functionality
     */
    function initSaveHandler() {
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            // Remove any existing listeners to prevent duplicates
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
            
            // Add our listener
            newSaveBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                handleSave();
            });
        } else {
            setTimeout(initSaveHandler, 100);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSaveHandler);
    } else {
        initSaveHandler();
    }

    // Export functions for use in other scripts
    window.collectLineEditData = collectLineEditData;
    window.handleSaveLineEdit = handleSave;

})();

