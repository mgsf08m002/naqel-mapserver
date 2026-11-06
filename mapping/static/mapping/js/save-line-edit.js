(function() {
    'use strict';

    let currentLineId = null;
    let drawInstance = null;
    let currentFeatureLabel = 'Line';

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

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

    function syncRiyadhRoadContextAfterPersist(editData, serverData) {
        if (!editData || !editData.is_riyadh_road) {
            return;
        }
        const label = String(
            editData.current_feature_label || editData.feature_type || ''
        ).trim();
        let fc =
            (serverData && serverData.fclass) ||
            (editData.fields_data && editData.fields_data.fclass) ||
            '';
        if (!fc && typeof window.resolveRiyadhFclassForFeatureState === 'function') {
            fc = window.resolveRiyadhFclassForFeatureState(label) || '';
        }
        [window.approvedLineBeingEdited, window.selectedRiyadhRoad].forEach(function (r) {
            if (!r || !r.is_riyadh_road) {
                return;
            }
            if (label) {
                r.current_feature_label = label;
                r.feature_type = label;
            }
            const fd = Object.assign({}, r.fields_data || {});
            if (fc) {
                fd.fclass = fc;
            }
            r.fields_data = fd;
            if (
                window.RiyadhRoadShared &&
                typeof window.RiyadhRoadShared.normalizeRiyadhRoadTags === 'function'
            ) {
                window.RiyadhRoadShared.normalizeRiyadhRoadTags(r);
            }
        });
        try {
            const nameEl = document.getElementById('selectedFeatureName');
            const vizName = document.getElementById('lineVisualizationFeatureName');
            const curVal = document.getElementById('currentFeatureValue');
            if (label && nameEl) {
                nameEl.textContent = label;
            }
            if (label && vizName) {
                vizName.textContent = label;
            }
            if (label && curVal) {
                curVal.textContent = label;
            }
            if (
                label &&
                typeof window.syncRiyadhTileSelectionCoreForFeatureLabel === 'function'
            ) {
                window.syncRiyadhTileSelectionCoreForFeatureLabel(label);
            }
        } catch (eUi) {}
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

    function validateFeatureTypeForSave(editData) {
        const typeLabel = (
            editData.current_feature_label ||
            editData.feature_type ||
            ''
        ).trim();
        if (!typeLabel || typeLabel.toLowerCase() === 'line') {
            return uiT('toast_pick_road_type', 'Pick a road type');
        }
        return null;
    }

    function toast(message, type) {
        if (message && window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(message, type || 'info');
        }
    }

    function clearDraftMapDrawing() {
        if (
            window.lineDrawingHandler &&
            typeof window.lineDrawingHandler.clearDraftLineDrawingFromMap === 'function'
        ) {
            window.lineDrawingHandler.clearDraftLineDrawingFromMap();
            return;
        }
        if (typeof window.clearDraftLineDrawingFromMap === 'function') {
            window.clearDraftLineDrawingFromMap();
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
        const nameEl = document.getElementById('sidebar-feature-name-input');
        if (nameEl) {
            fieldsData.name = (nameEl.value || '').trim();
        }
        return fieldsData;
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
            toast(uiT('toast_couldnt_read_geometry', "Couldn't read road geometry"), 'error');
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

        let fieldsPayload = Object.assign({}, fieldsBase);
        const labelForFclass = featureLabelToUse || 'Line';
        if (typeof window.resolveRiyadhFclassForFeatureState === 'function') {
            const symFc = window.resolveRiyadhFclassForFeatureState(labelForFclass);
            if (symFc) {
                fieldsPayload.fclass = symFc;
            } else {
                delete fieldsPayload.fclass;
            }
        }
        if (isRiyadhRoadFlag) {
            fieldsPayload.road_closure = isRoadClosed ? 1 : 0;
        }

        return {
            geometry: geometry,
            feature_type: featureLabelToUse,
            current_feature_label: featureLabelToUse,
            fields_data: fieldsPayload,
            tags_data: [],
            relations_data: [],
            road_closure: isRoadClosed ? 1 : 0,
            is_riyadh_road: isRiyadhRoadFlag,
            riyadh_road_id: riyadhRoadId,
            closure_changed: closureChanged
        };
    }

    /** Server request_category → pending-review dialog copy. */
    const PENDING_REVIEW_COPY = {
        delete_road: {
            titleKey: 'review_title_delete',
            titleFallback: 'Delete sent for review',
            bodyKey: 'review_body_delete',
            bodyFallback: 'Waiting for review. The road stays on the map until then.',
        },
        new_road: {
            titleKey: 'review_title_new_road',
            titleFallback: 'New road sent for review',
            bodyKey: 'review_body_new_road',
            bodyFallback: 'Waiting for review. A preview stays on the map until then.',
        },
        new_road_geometry: {
            titleKey: 'review_title_reshape',
            titleFallback: 'Reshape sent for review',
            bodyKey: 'review_body_reshape',
            bodyFallback: 'Waiting for review. It will show on the map once approved.',
        },
        add_road_label: {
            titleKey: 'review_title_add_label',
            titleFallback: 'New label sent for review',
            bodyKey: 'review_body_add_label',
            bodyFallback: 'Waiting for review. It will show on the map once approved.',
        },
        change_road_label: {
            titleKey: 'review_title_change_label',
            titleFallback: 'Label change sent for review',
            bodyKey: 'review_body_change_label',
            bodyFallback: 'Waiting for review. It will show on the map once approved.',
        },
        new_feature_type: {
            titleKey: 'review_title_feature_type',
            titleFallback: 'Road type change sent for review',
            bodyKey: 'review_body_feature_type',
            bodyFallback: 'Waiting for review. It will show on the map once approved.',
        },
        road_attribute_edit: {
            titleKey: 'review_title_attributes',
            titleFallback: 'Update sent for review',
            bodyKey: 'review_body_attributes',
            bodyFallback: 'Waiting for review. It will show on the map once approved.',
        },
    };

    const PENDING_REVIEW_COPY_DEFAULT = {
        titleKey: 'review_title_generic',
        titleFallback: 'Edit sent for review',
        bodyKey: 'review_body_generic',
        bodyFallback: 'Waiting for review. It will show on the map once approved.',
    };

    function resolvePendingReviewCategory(meta, editData) {
        meta = meta || {};
        const fromServer = String(meta.requestCategory || '').trim();
        if (fromServer) {
            return fromServer;
        }
        if (!editData || !editData.is_riyadh_road) {
            return 'new_road';
        }
        return 'road_attribute_edit';
    }

    function pendingReviewCopyForCategory(category) {
        const entry = PENDING_REVIEW_COPY[category] || PENDING_REVIEW_COPY_DEFAULT;
        return {
            title: uiT(entry.titleKey, entry.titleFallback),
            body: uiT(entry.bodyKey, entry.bodyFallback),
        };
    }

    function openPendingReviewDialog(category) {
        const copy = pendingReviewCopyForCategory(category);

        const existing = document.getElementById('pendingReviewDialog');
        if (existing) {
            existing.remove();
        }

        const backdrop = document.createElement('div');
        backdrop.id = 'pendingReviewDialog';
        backdrop.className = 'msp-review-dialog';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-labelledby', 'pendingReviewDialogTitle');

        const card = document.createElement('div');
        card.className = 'msp-review-dialog__card';

        const status = document.createElement('p');
        status.className = 'msp-review-dialog__status';
        status.textContent = uiT('review_status', 'Pending review');

        const title = document.createElement('h2');
        title.id = 'pendingReviewDialogTitle';
        title.className = 'msp-review-dialog__title';
        title.textContent = copy.title;

        const message = document.createElement('p');
        message.className = 'msp-review-dialog__body';
        message.textContent = copy.body;

        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'msp-review-dialog__btn';
        doneBtn.textContent = uiT('review_done', 'Done');

        card.appendChild(status);
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

        try {
            doneBtn.focus();
        } catch (eFocus) {}
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
        const pendingMeta = opts.pendingReviewMeta || {};

        if (autoApproved) {
            toast(uiT('toast_changes_live', 'Changes live'), 'success');
            return;
        }

        if (pendingSubmitted) {
            if (closureApplied && typeof roadClosure === 'number') {
                toast(
                    roadClosure === 1
                        ? uiT('toast_road_closed', 'Road closed')
                        : uiT('toast_road_open', 'Road open'),
                    'success'
                );
                return;
            }
            openPendingReviewDialog(
                resolvePendingReviewCategory(pendingMeta, opts.editDataForReview || null)
            );
            return;
        }

        if (closureApplied && typeof roadClosure === 'number') {
            toast(
                roadClosure === 1
                    ? uiT('toast_closure_saved', 'Closure saved')
                    : uiT('toast_road_reopened', 'Road reopened'),
                'success'
            );
            return;
        }

        toast(uiT('toast_saved', 'Saved'), 'info');
    }

    function applySuccessfulSaveSideEffects(editData, pendingSubmitted, saveMeta) {
        saveMeta = saveMeta || {};
        if (window.roadGeometryEdit && typeof window.roadGeometryEdit.stop === 'function') {
            window.roadGeometryEdit.stop();
        }
        if (typeof window.syncRiyadhGeometryEditToolbarButton === 'function') {
            window.syncRiyadhGeometryEditToolbarButton();
        }

        const shouldClearDraftMap =
            editData && (pendingSubmitted || saveMeta.autoApproved);

        if (shouldClearDraftMap) {
            if (pendingSubmitted && editData.is_riyadh_road) {
                revertPendingApprovalVisualization(editData);
            }
            try {
                clearDraftMapDrawing();
            } catch (e) {}
        }

        if (typeof window.setRoadLabelFieldEditing === 'function') {
            window.setRoadLabelFieldEditing(false);
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
                    labelSpan.textContent =
                        saveBtn.dataset.originalLabel ||
                        uiT('save', 'Save');
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
                    saveBtn.dataset.originalLabel =
                        labelSpan.textContent || uiT('save', 'Save');
                }
                var savingLabel = uiT('saving', 'Saving...');
                labelSpan.textContent = active
                    ? savingLabel
                    : saveBtn.dataset.originalLabel || uiT('save', 'Save');
            }
        }

        if (window.__riyadhRoadDeleteIntent) {
            const payload =
                typeof window.buildRiyadhRoadDeleteRequestPayload === 'function'
                    ? window.buildRiyadhRoadDeleteRequestPayload()
                    : null;
            if (!payload) {
                toast(uiT('toast_select_to_delete', 'Select a road to delete'), 'warning');
                return;
            }
            if (
                window.PendingRoadLocks &&
                typeof window.PendingRoadLocks.assertRoadEditable === 'function' &&
                !window.PendingRoadLocks.assertRoadEditable(payload.target_id)
            ) {
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
                            (typeof window.safeUserMessage === 'function'
                                ? window.safeUserMessage(
                                      data,
                                      uiT('toast_couldnt_delete', "Couldn't delete. Try again.")
                                  )
                                : uiT('toast_couldnt_delete', "Couldn't delete. Try again.")),
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
                    if (autoApproved) {
                        window.runRiyadhRoadSaveMapTransition(function () {
                            if (typeof window.applyLiveNetworkEditToMap === 'function') {
                                window.applyLiveNetworkEditToMap(
                                    Object.assign({}, data, { deleted_road_id: deletedRoadId })
                                );
                            }
                        });
                    }

                    if (autoApproved) {
                        toast(uiT('toast_road_deleted', 'Road deleted'), 'success');
                        try {
                            window.selectedRiyadhRoad = null;
                            window.approvedLineBeingEdited = null;
                            if (typeof window.setSelectedOverlayGeometry === 'function') {
                                window.setSelectedOverlayGeometry(null);
                            }
                            if (typeof window.syncDraftClosureMapLayers === 'function') {
                                window.syncDraftClosureMapLayers();
                            }
                        } catch (eClear) {}
                    } else {
                        showSaveOutcomeUI({
                            autoApproved: false,
                            pendingSubmitted: pendingSubmitted,
                            closureApplied: false,
                            roadClosure: 0,
                            serverMessage: '',
                            pendingReviewMeta: {
                                requestCategory: data.request_category || 'delete_road',
                            },
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
                    try {
                        window.dispatchEvent(new CustomEvent('pendingRoadLocks:refresh'));
                    } catch (eLock) {}
                })
                .catch(function () {
                    toast(uiT('toast_couldnt_delete', "Couldn't delete. Try again."), 'error');
                })
                .finally(finishSaveUi);
            return;
        }

        const editData = collectRoadEditData();
        if (!editData) {
            toast(uiT('toast_draw_road_first', 'Draw a road first'), 'warning');
            return;
        }

        const featureTypeErr = validateFeatureTypeForSave(editData);
        if (featureTypeErr) {
            toast(featureTypeErr, 'warning');
            return;
        }

        // Existing road: block reviewable edits while pending (closure-only still OK).
        if (
            editData.is_riyadh_road &&
            !editData.closure_changed &&
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.assertRoadEditable === 'function' &&
            !window.PendingRoadLocks.assertRoadEditable(editData.riyadh_road_id)
        ) {
            return;
        }

        // New draw: block submit near another pending new road (~40m).
        if (
            !editData.is_riyadh_road &&
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.assertNewRoadDrawable === 'function' &&
            !window.PendingRoadLocks.assertNewRoadDrawable(editData.geometry)
        ) {
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
                        (typeof window.safeUserMessage === 'function'
                            ? window.safeUserMessage(
                                  data,
                                  uiT('toast_couldnt_save', "Couldn't save. Try again.")
                              )
                            : uiT('toast_couldnt_save', "Couldn't save. Try again.")),
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

                window.runRiyadhRoadSaveMapTransition(function () {
                    var mapUpdateNeeded =
                        !pendingSubmitted || closureApplied || autoApproved;

                    if (
                        mapUpdateNeeded &&
                        typeof window.applyRiyadhNetworkMutationResponse === 'function'
                    ) {
                        window.applyRiyadhNetworkMutationResponse(data, editData);
                    }

                    if (
                        data.road_closure !== undefined &&
                        data.road_closure !== null &&
                        (editData.is_riyadh_road || !pendingSubmitted) &&
                        typeof window.syncRoadClosureStateAfterPersist === 'function'
                    ) {
                        window.syncRoadClosureStateAfterPersist(data.road_closure);
                    }

                    if (!pendingSubmitted && editData.is_riyadh_road) {
                        syncRiyadhRoadContextAfterPersist(editData, data);
                    }

                    applySuccessfulSaveSideEffects(editData, pendingSubmitted, {
                        autoApproved: autoApproved,
                    });
                });

                const outcomeOpts = {
                    autoApproved: autoApproved,
                    pendingSubmitted: pendingSubmitted,
                    closureApplied: closureApplied,
                    roadClosure: roadClosureFromServer,
                    serverMessage: data.message || '',
                };
                if (pendingSubmitted) {
                    outcomeOpts.editDataForReview = editData;
                    outcomeOpts.pendingReviewMeta = {
                        requestCategory: data.request_category || '',
                    };
                }
                showSaveOutcomeUI(outcomeOpts);
                if (pendingSubmitted || autoApproved) {
                    try {
                        if (
                            pendingSubmitted &&
                            editData &&
                            !editData.is_riyadh_road &&
                            editData.geometry &&
                            window.PendingRoadLocks &&
                            typeof window.PendingRoadLocks.upsertOptimisticNewRoad === 'function'
                        ) {
                            window.PendingRoadLocks.upsertOptimisticNewRoad(
                                editData.geometry,
                                data.request_id,
                                data.request_category || 'new_road'
                            );
                        }
                        window.dispatchEvent(new CustomEvent('pendingRoadLocks:refresh'));
                    } catch (eLock) {}
                }
            })
            .catch(function () {
                toast(uiT('toast_couldnt_save', "Couldn't save. Try again."), 'error');
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

