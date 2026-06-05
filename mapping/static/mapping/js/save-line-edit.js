(function() {
    'use strict';

    const RIYADH_MERGE_TAGS_INTO_FIELDS_SKIP = {
        name: true,
        road_closure: true,
        common_name: true,
        multilingual_names: true
    };

    /** Riyadh road: snapshot missing, unchanged diff, or non-classified pending edit. */
    const RIYADH_PENDING_BODY_GENERIC =
        'Your road updates are in the manager review queue. They will appear on the map after approval.';

    let currentLineId = null;
    let drawInstance = null;
    let currentFeatureLabel = 'Line';

    function getRiyadhRoadOriginalSnapshot(editData) {
        if (!editData || !editData.is_riyadh_road || editData.riyadh_road_id == null || !window.riyadhRoadOriginalState) {
            return null;
        }
        const key = String(editData.riyadh_road_id);
        return window.riyadhRoadOriginalState[key] || window.riyadhRoadOriginalState[editData.riyadh_road_id] || null;
    }

    function getOriginalFeatureLabelForTarget(editData) {
        if (!editData) {
            return null;
        }
        const st = getRiyadhRoadOriginalSnapshot(editData);
        if (st && st.feature_label) {
            return st.feature_label;
        }
        if (window.approvedLineBeingEdited && window.approvedLineBeingEdited._original_feature_label) {
            return window.approvedLineBeingEdited._original_feature_label;
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

            const st = getRiyadhRoadOriginalSnapshot(editData);
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
            }

            if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateFeatureTypeVisualization === 'function') {
                window.lineDrawingHandler.updateFeatureTypeVisualization();
            }
        } catch (e) {}
    }

    const FEATURE_TYPE_REQUIRED_MSG = 'Select a feature type for your road';

    function validateFeatureTypeForSave(editData) {
        const typeLabel = (
            editData.current_feature_label ||
            editData.feature_type ||
            ''
        ).trim();
        if (!typeLabel || typeLabel.toLowerCase() === 'line') {
            return FEATURE_TYPE_REQUIRED_MSG;
        }
        return null;
    }

    function toast(message, type) {
        if (message && window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(message, type || 'info');
        }
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

    function collectRoadEditData() {
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
            toast('Unable to get road geometry. Please try again.', 'error');
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
            const labelForFclass = featureLabelToUse || 'Line';
            if (typeof window.resolveRiyadhFclassForFeatureState === 'function') {
                const symFc = window.resolveRiyadhFclassForFeatureState(labelForFclass);
                if (symFc) {
                    fieldsPayload.fclass = symFc;
                } else {
                    delete fieldsPayload.fclass;
                }
            }
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

    function sortedJsonForFields(fields) {
        const f = fields && typeof fields === 'object' ? fields : {};
        const keys = Object.keys(f).sort();
        const out = {};
        keys.forEach(function (k) {
            out[k] = f[k];
        });
        return JSON.stringify(out);
    }

    /**
     * Explains what kind of edit is waiting for manager review (non-closure cases).
     * @param {object} editData - Payload from collectRoadEditData.
     * @param {{ reviewKind?: string }} meta - e.g. reviewKind 'delete' from delete flow.
     */
    function inferPendingReviewBody(editData, meta) {
        meta = meta || {};
        if (meta.reviewKind === 'delete') {
            return 'Your road deletion request is in the manager review queue. It will take effect only after approval.';
        }
        if (!editData || !editData.is_riyadh_road) {
            return 'Your request for a new road has been submitted for manager review. It will appear on the map after approval.';
        }
        const snap = getRiyadhRoadOriginalSnapshot(editData);
        if (!snap) {
            return RIYADH_PENDING_BODY_GENERIC;
        }
        const hasGeom =
            JSON.stringify(editData.geometry || null) !== JSON.stringify(snap.geometry || null);
        const hasFeat =
            String(editData.current_feature_label || editData.feature_type || '').trim() !==
            String(snap.feature_label || '').trim();
        const hasAttr =
            sortedJsonForFields(editData.fields_data) !== sortedJsonForFields(snap.fields_data) ||
            JSON.stringify(editData.tags_data || []) !== JSON.stringify(snap.tags_data || []);
        const count = (hasGeom ? 1 : 0) + (hasFeat ? 1 : 0) + (hasAttr ? 1 : 0);
        if (count === 0) {
            return RIYADH_PENDING_BODY_GENERIC;
        }
        if (count === 1) {
            if (hasGeom) {
                return 'Your road shape changes are in the manager review queue. They will appear on the map after approval.';
            }
            if (hasFeat) {
                return 'Your road classification change is in the manager review queue. It will appear on the map after approval.';
            }
            return 'Your road attribute updates are in the manager review queue. They will appear on the map after approval.';
        }
        if (count === 2) {
            if (hasGeom && hasFeat) {
                return 'Your road shape and classification changes are in the manager review queue. They will appear on the map after approval.';
            }
            if (hasGeom && hasAttr) {
                return 'Your road shape and attribute changes are in the manager review queue. They will appear on the map after approval.';
            }
            return 'Your road classification and attribute updates are in the manager review queue. They will appear on the map after approval.';
        }
        return 'Your road edits are in the manager review queue. They will appear on the map after approval.';
    }

    /**
     * Minimal dialog after an editor save that entered the manager review queue.
     * @param {string} bodyText - Message shown in the dialog body.
     * @param {{ reviewKind?: string }} [meta] - reviewKind 'delete' selects the dialog title.
     */
    function openPendingReviewDialog(bodyText, meta) {
        const m = meta || {};

        const backdrop = document.createElement('div');
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-labelledby', 'pendingReviewDialogTitle');
        backdrop.className =
            'fixed inset-0 z-[120] flex items-center justify-center p-5 sm:p-8 bg-zinc-950/30 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/25';

        const card = document.createElement('div');
        card.className =
            'relative w-full max-w-[26rem] rounded-[1.75rem] border border-zinc-200/80 bg-white px-8 pb-9 pt-10 sm:px-10 sm:pb-10 sm:pt-11 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.14)]';

        const eyebrow = document.createElement('p');
        eyebrow.className =
            'text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400';
        eyebrow.textContent = 'Pending review';

        const title = document.createElement('h2');
        title.id = 'pendingReviewDialogTitle';
        title.className =
            'mt-5 text-center text-[1.65rem] font-semibold leading-[1.2] tracking-[-0.02em] text-zinc-950 sm:text-[1.75rem]';
        title.textContent =
            m.reviewKind === 'delete' ? 'Deletion sent for review' : 'Edit sent for review';

        const message = document.createElement('p');
        message.className = 'mt-8 text-center text-[15px] leading-[1.65] text-zinc-600';
        message.textContent = bodyText;

        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className =
            'mt-10 w-full rounded-xl bg-zinc-950 py-[0.9rem] text-[15px] font-semibold text-white antialiased transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2';
        doneBtn.textContent = 'Done';

        card.appendChild(eyebrow);
        card.appendChild(title);
        card.appendChild(message);
        card.appendChild(doneBtn);
        backdrop.appendChild(card);
        document.body.appendChild(backdrop);

        function onKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                dismiss();
            }
        }

        function dismiss() {
            document.removeEventListener('keydown', onKeyDown);
            backdrop.remove();
        }

        document.addEventListener('keydown', onKeyDown);
        doneBtn.addEventListener('click', dismiss);
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) {
                dismiss();
            }
        });
    }

    function showSaveOutcomeUI(opts) {
        if (!opts) {
            return;
        }

        const autoApproved = !!opts.autoApproved;
        const pendingSubmitted = !!opts.pendingSubmitted;
        const closureApplied = !!opts.closureApplied;
        const roadClosure = opts.roadClosure;
        const serverMessage = opts.serverMessage ? String(opts.serverMessage) : '';
        const editDataForReview = opts.editDataForReview || null;

        if (autoApproved) {
            toast(
                serverMessage || 'Your edit was applied to the live road network.',
                'success'
            );
            return;
        }

        if (pendingSubmitted) {
            if (closureApplied && typeof roadClosure === 'number') {
                toast(
                    roadClosure === 1
                        ? 'Road closure is already live for everyone.'
                        : 'The road is shown as open for everyone.',
                    'success'
                );
                return;
            }
            const inferred = inferPendingReviewBody(editDataForReview, {
                reviewKind: opts.pendingReviewMeta && opts.pendingReviewMeta.reviewKind
            });
            const dialogBody = inferred || serverMessage || RIYADH_PENDING_BODY_GENERIC;
            openPendingReviewDialog(dialogBody, opts.pendingReviewMeta || {});
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

    function applySuccessfulSaveSideEffects(editData, pendingSubmitted, saveMeta) {
        saveMeta = saveMeta || {};
        if (window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
            window.roadGeometryEdit.stop();
        }
        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
        }
        if (typeof window.syncRiyadhRoadDeleteToolbarButton === 'function') {
            window.syncRiyadhRoadDeleteToolbarButton();
        }

        const clearDraftOverlay =
            (pendingSubmitted && editData) ||
            (saveMeta.autoApproved && editData && !editData.is_riyadh_road);

        if (clearDraftOverlay) {
            if (pendingSubmitted) {
                revertPendingApprovalVisualization(editData);
            }
            try {
                if (currentLineId && typeof window.removeMapLibreLineLayer === 'function') {
                    window.removeMapLibreLineLayer(currentLineId);
                }
                if (typeof window.clearVertexMarkers === 'function') {
                    window.clearVertexMarkers();
                }
            } catch (e) {}
        }

        if (window.exitEditModeAfterSuccessfulSave) {
            window.exitEditModeAfterSuccessfulSave();
        }
    }

    function handleSave() {
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn && saveBtn.disabled) {
            return;
        }

        function finishSaveUi() {
            if (saveBtn) {
                saveBtn.disabled = false;
                const labelSpan = saveBtn.querySelector('span');
                if (labelSpan) {
                    labelSpan.textContent = saveBtn.dataset.originalLabel || 'Save';
                }
            }
        }

        function setSavingUi(active) {
            if (!saveBtn) {
                return;
            }
            saveBtn.disabled = !!active;
            const labelSpan = saveBtn.querySelector('span');
            if (labelSpan) {
                if (!saveBtn.dataset.originalLabel) {
                    saveBtn.dataset.originalLabel = labelSpan.textContent || 'Save';
                }
                labelSpan.textContent = active ? 'Saving...' : saveBtn.dataset.originalLabel || 'Save';
            }
        }

        if (window.__riyadhRoadDeleteIntent) {
            const payload =
                typeof window.buildRiyadhRoadDeleteRequestPayload === 'function'
                    ? window.buildRiyadhRoadDeleteRequestPayload()
                    : null;
            if (!payload) {
                toast('Select a road to delete.', 'warning');
                return;
            }
            setSavingUi(true);
            fetch('/mapping/api/request/delete/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify(payload)
            })
                .then(function (response) {
                    return response.json();
                })
                .then(function (data) {
                    if (!data || !data.success) {
                        toast(
                            (data && data.message) || 'Failed to submit delete request.',
                            'error'
                        );
                        return;
                    }

                    if (typeof window.clearRiyadhRoadDeleteIntent === 'function') {
                        window.clearRiyadhRoadDeleteIntent();
                    }

                    const autoApproved = !!data.auto_approved;
                    const pendingSubmitted =
                        !!data.pending_submitted || (!autoApproved && !!data.success);

                    const deletedRoadId =
                        data.deleted_road_id != null ? data.deleted_road_id : payload.target_id;
                    if (autoApproved && typeof window.applyLiveNetworkEditToMap === 'function') {
                        window.applyLiveNetworkEditToMap(
                            Object.assign({}, data, { deleted_road_id: deletedRoadId }),
                            { reloadDelayMs: 0 }
                        );
                    }

                    if (autoApproved) {
                        toast(
                            data.message || 'Road deleted successfully.',
                            'success'
                        );
                        try {
                            window.selectedRiyadhRoad = null;
                            window.approvedLineBeingEdited = null;
                            if (typeof window.setSelectedOverlayGeometry === 'function') {
                                window.setSelectedOverlayGeometry(null);
                            }
                            if (typeof window.syncRiyadhTileSelectionSuppressionForDraftClosure === 'function') {
                                window.syncRiyadhTileSelectionSuppressionForDraftClosure();
                            }
                        } catch (eClear) {}
                    } else {
                        showSaveOutcomeUI({
                            autoApproved: false,
                            pendingSubmitted: pendingSubmitted,
                            closureApplied: false,
                            roadClosure: 0,
                            serverMessage: '',
                            pendingReviewMeta: { reviewKind: 'delete' },
                            editDataForReview: null
                        });
                    }

                    applySuccessfulSaveSideEffects(
                        pendingSubmitted
                            ? {
                                  is_riyadh_road: true,
                                  riyadh_road_id: payload.target_id,
                                  id: payload.target_id
                              }
                            : null,
                        pendingSubmitted
                    );
                })
                .catch(function () {
                    toast('Failed to submit delete request.', 'error');
                })
                .finally(finishSaveUi);
            return;
        }

        const editData = collectRoadEditData();
        if (!editData) {
            toast('Please draw a road on the map before saving.', 'warning');
            return;
        }

        const featureTypeErr = validateFeatureTypeForSave(editData);
        if (featureTypeErr) {
            toast(featureTypeErr, 'warning');
            return;
        }

        setSavingUi(true);

        fetch('/mapping/api/save-line-edit/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(editData)
        })
            .then(function (response) {
                return response.json();
            })
            .then(function (data) {
                if (!data || !data.success) {
                    toast(
                        'Error: ' + (data && data.message ? data.message : 'Failed to save edit request'),
                        'error'
                    );
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

                if (
                    !pendingSubmitted &&
                    typeof window.applyLiveNetworkEditToMap === 'function'
                ) {
                    const livePayload = Object.assign({}, data);
                    if (
                        livePayload.remote_road_id == null &&
                        editData.is_riyadh_road &&
                        editData.riyadh_road_id != null
                    ) {
                        livePayload.remote_road_id = editData.riyadh_road_id;
                    }
                    window.applyLiveNetworkEditToMap(livePayload, {
                        editData: editData,
                        reloadDelayMs: autoApproved ? 400 : 0,
                    });
                }

                const outcomeOpts = {
                    autoApproved: autoApproved,
                    pendingSubmitted: pendingSubmitted,
                    closureApplied: closureApplied,
                    roadClosure: roadClosureFromServer,
                    serverMessage: data.message || ''
                };
                if (pendingSubmitted) {
                    outcomeOpts.editDataForReview = editData;
                }
                showSaveOutcomeUI(outcomeOpts);

                applySuccessfulSaveSideEffects(editData, pendingSubmitted, {
                    autoApproved: autoApproved,
                });
            })
            .catch(function () {
                toast('Error saving edit request. Please try again.', 'error');
            })
            .finally(finishSaveUi);
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

})();

