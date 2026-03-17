// Save line edit: persists geometry, feature type, attributes, road closure. Manager saves auto-approve; others create pending requests.
(function() {
    'use strict';

    let currentLineId = null;
    let drawInstance = null;
    let currentFeatureLabel = 'Line';

    function getOriginalFeatureLabelForTarget(editData) {
        if (!editData) {
            return null;
        }

        if (editData.is_riyadh_road && editData.riyadh_road_id != null && window.riyadhRoadOriginalState) {
            const key = String(editData.riyadh_road_id);
            const state = window.riyadhRoadOriginalState[key] || window.riyadhRoadOriginalState[editData.riyadh_road_id];
            if (state && state.feature_label) {
                return state.feature_label;
            }
        }

        if (window.approvedLineBeingEdited) {
            const original = window.approvedLineBeingEdited._original_feature_label;
            if (original) {
                return original;
            }
        }

        return null;
    }

    function revertPendingApprovalVisualization(editData) {
        if (!editData) {
            return;
        }

        const originalLabel = getOriginalFeatureLabelForTarget(editData);
        if (!originalLabel) {
            return;
        }

        try {
            if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
                window.lineDrawingHandler.updateCurrentFeatureLabel(originalLabel);
            } else if (typeof window.updateCurrentFeatureLabel === 'function') {
                window.updateCurrentFeatureLabel(originalLabel);
            }

            const editScreen = document.getElementById('editFeatureScreen');

            const isRiyadhRoad = !!editData.is_riyadh_road;
            if (isRiyadhRoad && window.approvedLineBeingEdited && window.approvedLineBeingEdited.geometry) {
                const roadId = (window.approvedLineBeingEdited && window.approvedLineBeingEdited.id) || editData.riyadh_road_id;
                if (roadId != null && typeof window.updateRiyadhRoadVisualization === 'function') {
                    window.updateRiyadhRoadVisualization(roadId, originalLabel, window.approvedLineBeingEdited.geometry);
                } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateRiyadhRoadVisualization === 'function') {
                    window.lineDrawingHandler.updateRiyadhRoadVisualization(roadId, originalLabel, window.approvedLineBeingEdited.geometry);
                }
            }
            if (typeof window.updateFeatureTypeVisualization === 'function') {
                window.updateFeatureTypeVisualization();
            } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateFeatureTypeVisualization === 'function') {
                window.lineDrawingHandler.updateFeatureTypeVisualization();
            }
        } catch (e) {}
    }

    function showToastNotification(message, type) {
        if (!message) {
            return;
        }

        const normalizedType = type || 'info';

        function tryShowNotification(retries) {
            const remaining = typeof retries === 'number' ? retries : 10;

            if (window.notify && window.notify.show) {
                if (normalizedType === 'success') {
                    window.notify.success(message);
                } else if (normalizedType === 'error') {
                    window.notify.error(message);
                } else if (normalizedType === 'warning') {
                    window.notify.warning(message);
                } else {
                    window.notify.info(message);
                }
                return;
            }

            if (remaining > 0) {
                setTimeout(function () {
                    tryShowNotification(remaining - 1);
                }, 50);
            }
        }

        tryShowNotification(10);
    }

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

    function collectFieldsData() {
        const fieldsData = {};
        const fieldsContainer = document.getElementById('fields-container');
        
        if (!fieldsContainer) {
            return fieldsData;
        }

        const nameFieldContainer = fieldsContainer.querySelector('.bg-gray-700.rounded-lg');
        if (nameFieldContainer) {
            const nameInput = nameFieldContainer.querySelector('input[type="text"]');
            if (nameInput && nameInput.placeholder && nameInput.placeholder.includes('Name')) {
                fieldsData.name = nameInput.value || '';
            }
        }

        const commonNameInput = fieldsContainer.querySelector('.bg-gray-700.rounded-lg input[type="text"]:not([placeholder*="Name"])');
        if (commonNameInput) {
            fieldsData.common_name = commonNameInput.value || '';
        }

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

        const allFieldContainers = fieldsContainer.querySelectorAll('[id^="field-"]');
        allFieldContainers.forEach(function(fieldContainer) {
            const fieldId = fieldContainer.id.replace('field-', '');
            const input = fieldContainer.querySelector('input, textarea');
            
            if (input) {
                let fieldKey = fieldId.replace(/-/g, '_');
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

    function collectRelationsData() {
        const relationsData = [];
        const relationsRowsContainer = document.getElementById('relations-rows-container');
        
        if (!relationsRowsContainer) {
            return relationsData;
        }

        const relationRows = relationsRowsContainer.querySelectorAll('.space-y-2');
        relationRows.forEach(function(row) {
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
                relationsData.push({
                    parent_relation: parentRelation,
                    role: ''
                });
            }
        });

        return relationsData;
    }

    function collectLineEditData() {
        let geometry = null;
        let featureLabelToUse = 'Line';
        
        const isRiyadhRoad = window.selectedRiyadhRoad || (window.approvedLineBeingEdited && window.approvedLineBeingEdited.is_riyadh_road);
        
        if (isRiyadhRoad || (window.approvedLineBeingEdited && window.approvedLineBeingEdited.geometry)) {
            const riyadhRoadData = window.selectedRiyadhRoad || window.approvedLineBeingEdited;
            if (riyadhRoadData && riyadhRoadData.geometry) {
                geometry = riyadhRoadData.geometry;
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

        let isRoadClosed = false;
        if (typeof window.getCurrentRoadClosure === 'function') {
            try {
                isRoadClosed = !!window.getCurrentRoadClosure();
            } catch (e) {
                isRoadClosed = false;
            }
        }

        const initialClosure =
            typeof window.initialRoadClosureState === 'boolean'
                ? window.initialRoadClosureState
                : isRoadClosed;
        const closureChanged = initialClosure !== isRoadClosed;

        let isRiyadhRoadFlag = !!isRiyadhRoad;
        let riyadhRoadId = null;
        if (isRiyadhRoadFlag) {
            const riyadhSource = window.selectedRiyadhRoad || window.approvedLineBeingEdited;
            if (riyadhSource) {
                if (riyadhSource.riyadh_road_id != null) {
                    riyadhRoadId = riyadhSource.riyadh_road_id;
                } else if (riyadhSource.id != null) {
                    riyadhRoadId = riyadhSource.id;
                }
            }
        }
        
        return {
            geometry: geometry,
            feature_type: featureLabelToUse,
            current_feature_label: featureLabelToUse,
            fields_data: collectFieldsData(),
            tags_data: collectTagsData(),
            relations_data: collectRelationsData(),
            road_closure: isRoadClosed ? 1 : 0,
            is_riyadh_road: isRiyadhRoadFlag,
            riyadh_road_id: riyadhRoadId,
            closure_changed: closureChanged
        };
    }

    function syncRoadClosureImmediate(editData) {
        if (
            !editData ||
            typeof editData.road_closure !== 'number' ||
            !editData.closure_changed
        ) {
            return;
        }

        let targetType = null;
        let targetId = null;

        if (editData.is_riyadh_road && editData.riyadh_road_id != null) {
            targetType = 'riyadh_road';
            targetId = editData.riyadh_road_id;
        }

        if (!targetType || targetId == null) {
            return;
        }

        const payload = {
            target_type: targetType,
            target_id: targetId,
            road_closure: editData.road_closure
        };

        fetch('/mapping/api/set-road-closure/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload)
        })
        .then(function(response) {
            if (!response.ok) {
                return null;
            }
            return response.json();
        })
        .then(function(data) {
            if (!data || !data.success) {
                return;
            }
        })
        .catch(function() {});
    }

    function showSaveConfirmationPopup(options) {
        const isAutoApproved = options && options.isAutoApproved;
        const closureChanged = options && options.closureChanged;
        const roadClosureValue = options && typeof options.roadClosure === 'number'
            ? options.roadClosure
            : null;

        if (closureChanged && roadClosureValue !== null) {
            const isClosed = roadClosureValue === 1;
            const message = isClosed
                ? 'The road has been marked closed.'
                : 'The road has been marked opened.';

            showToastNotification(message, 'success');
            return;
        }

        const popup = document.createElement('div');
        popup.id = 'saveConfirmationPopup';
        popup.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
        
        let title;
        let messageText;

        if (isAutoApproved) {
            title = 'Edit Saved Successfully';
            messageText = 'Your edit has been saved and will appear on the map after reload.';
        } else {
            title = 'Edit Request Submitted';
            messageText = 'Your edit has been sent to the manager and will be approved or rejected accordingly.';
        }
        
        popup.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                <div class="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full">
                    <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </div>
                <h3 class="text-lg font-semibold text-gray-900 text-center mb-2">${title}</h3>
                <p class="text-sm text-gray-600 text-center mb-6">
                    ${messageText}
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

    // Handle save button click.
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

        syncRoadClosureImmediate(editData);

        if (saveBtn) {
            saveBtn.disabled = true;
            const labelSpan = saveBtn.querySelector('span');
            if (labelSpan) {
                if (!saveBtn.dataset.originalLabel) {
                    saveBtn.dataset.originalLabel = labelSpan.textContent || 'Save';
                }
                labelSpan.textContent = 'Saving...';
            }
        }

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
                const closureChanged = !!editData.closure_changed;
                showSaveConfirmationPopup({
                    isAutoApproved: isAutoApproved,
                    closureChanged: closureChanged,
                    roadClosure: editData.road_closure
                });
                
                if (isAutoApproved) {
                    setTimeout(function() {
                        if (typeof window.triggerRiyadhTilesReload === 'function') {
                            window.triggerRiyadhTilesReload(data.tiles_version);
                        }
                    }, 1500);
                } else {
                    revertPendingApprovalVisualization(editData);

                    try {
                        if (currentLineId && typeof window.removeMapLibreLineLayer === 'function') {
                            window.removeMapLibreLineLayer(currentLineId);
                        }
                        if (typeof window.clearVertexMarkers === 'function') {
                            window.clearVertexMarkers();
                        }
                    } catch (e) {}
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
                const labelSpan = saveBtn.querySelector('span');
                if (labelSpan) {
                    const originalLabel = saveBtn.dataset.originalLabel || 'Save';
                    labelSpan.textContent = originalLabel;
                }
            }
        });
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

    function initSaveHandler() {
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSaveHandler);
    } else {
        initSaveHandler();
    }

    window.collectLineEditData = collectLineEditData;
    window.handleSaveLineEdit = handleSave;
    window.showToastNotification = showToastNotification;

})();

