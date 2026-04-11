// Persists line edits; Riyadh road_closure is written to the network immediately for every role.
(function() {
    'use strict';

    const RIYADH_MERGE_TAGS_INTO_FIELDS_SKIP = {
        name: true,
        road_closure: true,
        common_name: true,
        multilingual_names: true
    };

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

        try {
            if (originalLabel) {
                if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
                    window.lineDrawingHandler.updateCurrentFeatureLabel(originalLabel);
                } else if (typeof window.updateCurrentFeatureLabel === 'function') {
                    window.updateCurrentFeatureLabel(originalLabel);
                }
            }

            const editScreen = document.getElementById('editFeatureScreen');
            const labelForMap = originalLabel || (window.approvedLineBeingEdited && (
                window.approvedLineBeingEdited.current_feature_label || window.approvedLineBeingEdited.feature_type
            )) || 'Line';

            if (editData.is_riyadh_road && editData.riyadh_road_id != null && window.riyadhRoadOriginalState) {
                const key = String(editData.riyadh_road_id);
                const st = window.riyadhRoadOriginalState[key] || window.riyadhRoadOriginalState[editData.riyadh_road_id];
                if (st && st.geometry) {
                    const geom = JSON.parse(JSON.stringify(st.geometry));
                    if (window.approvedLineBeingEdited) {
                        window.approvedLineBeingEdited = Object.assign({}, window.approvedLineBeingEdited, { geometry: geom });
                    }
                    if (window.selectedRiyadhRoad) {
                        window.selectedRiyadhRoad = Object.assign({}, window.selectedRiyadhRoad, { geometry: geom });
                    }
                    if (typeof window.setSelectedOverlayGeometry === 'function') {
                        window.setSelectedOverlayGeometry(geom);
                    }
                    if (editScreen) {
                        editScreen.setAttribute('data-request-geometry', JSON.stringify(geom));
                    }
                    const roadId = (window.approvedLineBeingEdited && window.approvedLineBeingEdited.id) || editData.riyadh_road_id;
                    if (roadId != null && window.lineDrawingHandler && typeof window.lineDrawingHandler.updateRiyadhRoadVisualization === 'function') {
                        window.lineDrawingHandler.updateRiyadhRoadVisualization(roadId, labelForMap, geom);
                    }
                    const hadGeometryEdit = window.__roadGeometryEditActiveId != null;
                    if (hadGeometryEdit && window.roadGeometryEdit && typeof window.roadGeometryEdit.startFromRiyadhContext === 'function') {
                        setTimeout(function() {
                            window.roadGeometryEdit.startFromRiyadhContext();
                        }, 80);
                    }
                }
            }

            if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateFeatureTypeVisualization === 'function') {
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
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentLineId === 'function') {
            currentLineId = window.lineDrawingHandler.getCurrentLineId();
        }
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentFeatureLabel === 'function') {
            currentFeatureLabel = window.lineDrawingHandler.getCurrentFeatureLabel();
        }
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getDrawInstance === 'function') {
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

        const nameEl = document.getElementById('sidebar-feature-name-input');
        if (nameEl) {
            const v = (nameEl.value || '').trim();
            fieldsData.name = v;
            fieldsData.common_name = v;
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
            const inputs = row.querySelectorAll('input[type="text"]');
            if (inputs.length < 2) {
                return;
            }
            const key = (inputs[0].value || '').trim();
            const value = (inputs[1].value || '').trim();
            if (!key && !value) {
                return;
            }
            tagsData.push({
                key: key,
                value: value
            });
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
                if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getCurrentFeatureLabel === 'function') {
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

        const fieldsBase = collectFieldsData();
        const tagsCollected = collectTagsData();
        const relationsCollected = collectRelationsData();

        let fieldsPayload = fieldsBase;
        if (isRiyadhRoadFlag) {
            fieldsPayload = Object.assign({}, fieldsBase);
            tagsCollected.forEach(function (t) {
                if (!t) {
                    return;
                }
                const k = t.key != null ? String(t.key).trim() : '';
                if (!k || RIYADH_MERGE_TAGS_INTO_FIELDS_SKIP[k]) {
                    return;
                }
                fieldsPayload[k] = t.value != null ? t.value : '';
            });
            fieldsPayload.road_closure = isRoadClosed ? 1 : 0;
        }

        return {
            geometry: geometry,
            feature_type: featureLabelToUse,
            current_feature_label: featureLabelToUse,
            fields_data: fieldsPayload,
            tags_data: tagsCollected,
            relations_data: relationsCollected,
            road_closure: isRoadClosed ? 1 : 0,
            is_riyadh_road: isRiyadhRoadFlag,
            riyadh_road_id: riyadhRoadId,
            closure_changed: closureChanged
        };
    }

    function isValidRoadLabelInput(value) {
        const text = (value || '').trim();
        if (!text) {
            return false;
        }
        // Require at least one Arabic, English, or numeric character.
        return /[\u0600-\u06FFA-Za-z0-9]/.test(text);
    }

    function showSaveOutcomeUI(opts) {
        const autoApproved = !!(opts && opts.autoApproved);
        const pendingSubmitted = !!(opts && opts.pendingSubmitted);
        const closureApplied = !!(opts && opts.closureApplied);
        const roadClosure = opts && opts.roadClosure;
        const serverMessage = (opts && opts.serverMessage) ? String(opts.serverMessage) : '';

        function toast(msg, type) {
            showToastNotification(msg, type || 'info');
        }

        function openReviewModal(bodyText) {
            const popup = document.createElement('div');
            popup.id = 'saveConfirmationPopup';
            popup.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
            const card = document.createElement('div');
            card.className = 'bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6';
            const iconWrap = document.createElement('div');
            iconWrap.className = 'flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-amber-50 rounded-full';
            iconWrap.innerHTML = '<svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
            const title = document.createElement('h3');
            title.className = 'text-lg font-semibold text-gray-900 text-center mb-2';
            title.textContent = 'Submitted for manager review';
            const p = document.createElement('p');
            p.className = 'text-sm text-gray-600 text-center mb-6';
            p.textContent = bodyText;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'closeConfirmationPopup';
            btn.className = 'w-full px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium';
            btn.textContent = 'OK';
            card.appendChild(iconWrap);
            card.appendChild(title);
            card.appendChild(p);
            card.appendChild(btn);
            popup.appendChild(card);
            document.body.appendChild(popup);
            btn.addEventListener('click', function() {
                popup.remove();
            });
            popup.addEventListener('click', function(e) {
                if (e.target === popup) {
                    popup.remove();
                }
            });
        }

        if (autoApproved) {
            toast(serverMessage || 'Your edit was applied to the live road network.', 'success');
            return;
        }

        if (pendingSubmitted) {
            const defaultPending =
                closureApplied && typeof roadClosure === 'number'
                    ? roadClosure === 1
                        ? 'Road closure is already live for everyone. A manager will review your other changes before they appear on the map.'
                        : 'The road is shown as open for everyone. A manager will review your other changes before they appear on the map.'
                    : 'A manager will review your geometry and attribute changes. They will appear on the map after approval.';
            openReviewModal(serverMessage || defaultPending);
            return;
        }

        if (closureApplied && typeof roadClosure === 'number') {
            toast(
                roadClosure === 1
                    ? 'Road closure saved. Nothing else requires review.'
                    : 'Road reopening saved. Nothing else requires review.',
                'success'
            );
            return;
        }

        toast(serverMessage || 'Saved.', 'info');
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

        if (editData.is_riyadh_road) {
            const roadLabel = editData.fields_data && editData.fields_data.name != null
                ? String(editData.fields_data.name)
                : '';
            if (!isValidRoadLabelInput(roadLabel)) {
                alert('Road Label is required and must contain valid Arabic or English text.');
                return;
            }
        }

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
            if (!data || !data.success) {
                alert('Error: ' + (data && data.message ? data.message : 'Failed to save edit request'));
                return;
            }

            const autoApproved = !!data.auto_approved;
            const pendingSubmitted = !!data.pending_submitted;
            const closureApplied = !!data.closure_applied;
            const roadClosureFromServer =
                data.road_closure !== undefined && data.road_closure !== null
                    ? data.road_closure
                    : editData.road_closure;

            if (
                data.road_closure !== undefined &&
                data.road_closure !== null &&
                (editData.is_riyadh_road || !pendingSubmitted) &&
                typeof window.syncRoadClosureStateAfterPersist === 'function'
            ) {
                window.syncRoadClosureStateAfterPersist(data.road_closure);
            }

            // Keep MVT symbology aligned with remote DB before/while new tiles propagate (tiles_version).
            // Do not apply proposed fclass while the edit is pending approval — the map must keep
            // showing the pre-submit network state until a manager approves (revert runs next).
            if (
                !pendingSubmitted &&
                editData.is_riyadh_road &&
                editData.riyadh_road_id != null &&
                typeof window.applyRiyadhRoadDbFclassFromDatabase === 'function'
            ) {
                const fd = editData.fields_data || {};
                let fc = fd.fclass != null ? String(fd.fclass).trim() : '';
                if (!fc) {
                    const cat = window.symbologyCatalog;
                    const inv = cat && cat.riyadh_label_to_fclass;
                    const lab = (editData.feature_type || editData.current_feature_label || '')
                        .trim()
                        .toLowerCase();
                    fc = inv && inv[lab] ? inv[lab] : '';
                }
                if (fc) {
                    window.applyRiyadhRoadDbFclassFromDatabase(editData.riyadh_road_id, fc);
                }
            }

            if (data.tiles_version != null && typeof window.triggerRiyadhTilesReload === 'function') {
                setTimeout(function() {
                    window.triggerRiyadhTilesReload(data.tiles_version);
                }, autoApproved ? 900 : 400);
            }

            showSaveOutcomeUI({
                autoApproved: autoApproved,
                pendingSubmitted: pendingSubmitted,
                closureApplied: closureApplied,
                roadClosure: roadClosureFromServer,
                serverMessage: data.message || ''
            });

            if (autoApproved) {
                if (window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
                    window.roadGeometryEdit.stop();
                }
            } else if (pendingSubmitted) {
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

    window.handleSaveLineEdit = handleSave;
    window.showToastNotification = showToastNotification;

})();

