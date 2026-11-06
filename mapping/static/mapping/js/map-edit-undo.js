(function() {
    'use strict';

    var MAX_STACK = 50;
    var DEBOUNCE_MS = 200;

    var undoStack = [];
    var redoStack = [];
    var isApplying = false;
    var lastCommittedState = null;
    var changeBurstOpen = false;
    var changeDebounceTimer = null;
    var drawListenersBound = false;
    var initRetryCount = 0;

    // Active linestring draw: per-vertex undo, collapsed to one step on finish.
    var drawSessionBaseState = null;
    var drawSessionUndoCount = 0;
    var resumeLinestringAfterApply = false;

    function getDrawInstance() {
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getDrawInstance === 'function') {
            var fromHandler = window.lineDrawingHandler.getDrawInstance();
            if (fromHandler) {
                return fromHandler;
            }
        }
        if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            return draw.getTerraDrawInstance();
        }
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            return drawInstance;
        }
        return null;
    }

    function isEditModeActive() {
        return typeof window.isMapEditModeActive === 'function' && window.isMapEditModeActive();
    }

    function getDrawMode() {
        var instance = getDrawInstance();
        if (!instance || typeof instance.getMode !== 'function') {
            return null;
        }
        try {
            return instance.getMode();
        } catch (e) {
            return null;
        }
    }

    function isLinestringDrawing() {
        return getDrawMode() === 'linestring';
    }

    function cloneState(state) {
        return JSON.parse(JSON.stringify(state));
    }

    function samePosition(a, b) {
        return !!a && !!b && a[0] === b[0] && a[1] === b[1];
    }

    function getLinestringMode(drawApi) {
        if (!drawApi) {
            return null;
        }
        if (drawApi._mode && drawApi._mode.mode === 'linestring') {
            return drawApi._mode;
        }
        if (drawApi._modes && drawApi._modes.linestring) {
            return drawApi._modes.linestring;
        }
        return null;
    }

    function normalizeCommittedLineCoords(coords) {
        if (!Array.isArray(coords) || coords.length === 0) {
            return null;
        }
        var next = cloneState(coords);
        // Terra Draw createLine seeds the first click as [p, p].
        if (next.length === 1) {
            next = [next[0], next[0]];
        }
        return next;
    }

    function isFirstClickCommittedCoords(coords) {
        return !!coords && coords.length === 2 && samePosition(coords[0], coords[1]);
    }

    function listLineStringFeatures(features) {
        if (!Array.isArray(features)) {
            return [];
        }
        return features.filter(function(feature) {
            return !!(feature && feature.geometry && feature.geometry.type === 'LineString');
        });
    }

    function findResumeLineFeature(features, currentId) {
        var lines = listLineStringFeatures(features);

        // Live draw: only the current feature may be resumed.
        if (currentId != null) {
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].id === currentId) {
                    return lines[i];
                }
            }
            return null;
        }

        // After cleanUp (redo of first vertex): restore the line missing from the store.
        var existingIds = {};
        var drawApi = getDrawInstance();
        if (drawApi && typeof drawApi.getSnapshot === 'function') {
            try {
                listLineStringFeatures(drawApi.getSnapshot()).forEach(function(feature) {
                    if (feature.id != null) {
                        existingIds[String(feature.id)] = true;
                    }
                });
            } catch (eSnap) {}
        }

        var missing = null;
        lines.forEach(function(feature) {
            if (feature.id != null && !existingIds[String(feature.id)]) {
                missing = feature;
            }
        });
        return missing || (lines.length ? lines[lines.length - 1] : null);
    }

    function deleteModePoint(mode, idKey) {
        if (!mode || mode[idKey] == null) {
            return;
        }
        if (mode.store && typeof mode.store.delete === 'function') {
            try {
                mode.store.delete([mode[idKey]]);
            } catch (eDelete) {}
        }
        mode[idKey] = undefined;
    }

    function clearLinestringGuidancePoints(mode) {
        deleteModePoint(mode, 'snappedPointId');
        deleteModePoint(mode, 'closingPointId');
    }

    function scrubOrphanLinestringPoints(drawApi, mode) {
        if (!drawApi || typeof drawApi.getSnapshot !== 'function' || typeof drawApi.removeFeatures !== 'function') {
            return;
        }

        var keep = {};
        if (mode) {
            if (mode.currentId != null) {
                keep[String(mode.currentId)] = true;
            }
            if (mode.closingPointId != null) {
                keep[String(mode.closingPointId)] = true;
            }
            if (mode.snappedPointId != null) {
                keep[String(mode.snappedPointId)] = true;
            }
        }

        var orphans = [];
        try {
            drawApi.getSnapshot().forEach(function(feature) {
                if (!feature || !feature.geometry || feature.geometry.type !== 'Point' || feature.id == null) {
                    return;
                }
                if (keep[String(feature.id)]) {
                    return;
                }
                var props = feature.properties || {};
                if (props.mode && props.mode !== 'linestring') {
                    return;
                }
                orphans.push(feature.id);
            });
        } catch (eSnap) {
            return;
        }

        if (orphans.length) {
            try {
                drawApi.removeFeatures(orphans);
            } catch (eRemove) {}
        }
    }

    function placeClosingPointAtTip(mode, tip) {
        if (!mode || !tip || !mode.store || typeof mode.store.create !== 'function') {
            return;
        }
        deleteModePoint(mode, 'closingPointId');
        try {
            var created = mode.store.create([
                {
                    geometry: { type: 'Point', coordinates: cloneState(tip) },
                    properties: { mode: mode.mode || 'linestring' }
                }
            ]);
            mode.closingPointId = Array.isArray(created) ? created[0] : created;
        } catch (eCreate) {
            mode.closingPointId = undefined;
        }
        if (typeof mode.setCursor === 'function' && mode.cursors && mode.cursors.close) {
            try {
                mode.setCursor(mode.cursors.close);
            } catch (eCursor) {}
        }
    }

    function syncLinestringModeCounters(mode, coords) {
        if (!mode) {
            return;
        }
        if (isFirstClickCommittedCoords(coords)) {
            mode.currentCoordinate = 1;
        } else {
            mode.currentCoordinate = Math.max(2, coords.length - 1);
        }
        if (typeof mode.setDrawing === 'function' && mode.state !== 'drawing') {
            try {
                mode.setDrawing();
            } catch (eDrawState) {}
        }
    }

    function setLinestringCommittedGeometry(mode, coords) {
        if (!mode || !coords) {
            return false;
        }

        // Drop snap / closing markers first so undo never leaves a ghost point.
        clearLinestringGuidancePoints(mode);

        var firstClick = isFirstClickCommittedCoords(coords);
        var tip = coords[coords.length - 1];

        if (typeof mode.updateGeometries === 'function') {
            mode.updateGeometries(coords, undefined, 'commit');
        } else if (mode.currentId && mode.store && typeof mode.store.updateGeometry === 'function') {
            mode.store.updateGeometry([
                {
                    id: mode.currentId,
                    geometry: { type: 'LineString', coordinates: coords }
                }
            ]);
            mode.lastCommitedCoordinates = cloneState(coords);
        } else {
            return false;
        }

        syncLinestringModeCounters(mode, coords);
        if (!firstClick) {
            placeClosingPointAtTip(mode, tip);
        }
        return true;
    }

    /**
     * Keep Terra Draw's in-progress linestring session alive across undo/redo.
     * clear()+addFeatures()+setMode('linestring') finishes the feature and breaks continue-draw.
     */
    function applyInProgressLinestringState(drawApi, targetFeatures) {
        var mode = getLinestringMode(drawApi);
        if (!mode) {
            return false;
        }

        var resumeFeature = findResumeLineFeature(targetFeatures, mode.currentId);
        var resumeCoords = resumeFeature
            ? normalizeCommittedLineCoords(
                  resumeFeature.geometry && resumeFeature.geometry.coordinates
              )
            : null;

        if (!resumeCoords) {
            if (mode.currentId != null && typeof mode.cleanUp === 'function') {
                mode.cleanUp();
            } else {
                clearLinestringGuidancePoints(mode);
            }
            scrubOrphanLinestringPoints(drawApi, mode);
            return true;
        }

        var applied = false;
        if (mode.currentId != null) {
            applied = setLinestringCommittedGeometry(mode, resumeCoords);
        } else if (mode.store && typeof mode.store.create === 'function') {
            try {
                var created = mode.store.create([
                    {
                        geometry: { type: 'LineString', coordinates: resumeCoords },
                        properties: { mode: 'linestring' }
                    }
                ]);
                mode.currentId = Array.isArray(created) ? created[0] : created;
                mode.lastCommitedCoordinates = cloneState(resumeCoords);
                syncLinestringModeCounters(mode, resumeCoords);
                if (!isFirstClickCommittedCoords(resumeCoords)) {
                    placeClosingPointAtTip(mode, resumeCoords[resumeCoords.length - 1]);
                }
                applied = mode.currentId != null;
            } catch (eCreate) {
                return false;
            }
        }

        if (applied) {
            scrubOrphanLinestringPoints(drawApi, mode);
        }
        return applied;
    }

    function captureTerraDrawState() {
        var drawApi = getDrawInstance();
        if (!drawApi || typeof drawApi.getSnapshot !== 'function') {
            return [];
        }
        try {
            var features = listLineStringFeatures(drawApi.getSnapshot());
            var lineMode = getLinestringMode(drawApi);

            // Persist committed vertices only (ignore live rubber-band cursor point).
            if (
                lineMode &&
                lineMode.currentId != null &&
                Array.isArray(lineMode.lastCommitedCoordinates) &&
                lineMode.lastCommitedCoordinates.length > 0
            ) {
                var committed = cloneState(lineMode.lastCommitedCoordinates);
                features = features.map(function(feature) {
                    if (!feature || feature.id !== lineMode.currentId) {
                        return feature;
                    }
                    return {
                        type: feature.type || 'Feature',
                        id: feature.id,
                        geometry: {
                            type: 'LineString',
                            coordinates: committed
                        },
                        properties: feature.properties || { mode: 'linestring' }
                    };
                });
            }

            return cloneState(features);
        } catch (e) {
            return [];
        }
    }

    function captureRiyadhGeometryState() {
        if (window.roadGeometryEdit && typeof window.roadGeometryEdit.getStateSnapshot === 'function') {
            return window.roadGeometryEdit.getStateSnapshot();
        }
        return null;
    }

    function captureFullState() {
        return {
            terradraw: captureTerraDrawState(),
            riyadh: captureRiyadhGeometryState()
        };
    }

    function statesEqual(a, b) {
        if (!a || !b) {
            return false;
        }
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function countLineVertices(state) {
        var features = state && Array.isArray(state.terradraw) ? state.terradraw : [];
        var total = 0;
        features.forEach(function(feature) {
            if (
                feature &&
                feature.geometry &&
                feature.geometry.type === 'LineString' &&
                Array.isArray(feature.geometry.coordinates)
            ) {
                total += feature.geometry.coordinates.length;
            }
        });
        return total;
    }

    function applyTerraDrawState(features) {
        var drawApi = getDrawInstance();
        if (!drawApi) {
            return;
        }

        var target = Array.isArray(features) ? cloneState(features) : [];
        var resumeDraw = resumeLinestringAfterApply;

        try {
            if (resumeDraw && applyInProgressLinestringState(drawApi, target)) {
                return;
            }

            var modeName = typeof drawApi.getMode === 'function' ? drawApi.getMode() : null;
            if (modeName && modeName !== 'static' && modeName !== 'select' && typeof drawApi.setMode === 'function') {
                drawApi.setMode('select');
            }

            if (typeof drawApi.clear === 'function') {
                drawApi.clear();
            }

            if (target.length > 0 && typeof drawApi.addFeatures === 'function') {
                drawApi.addFeatures(target);
            }
        } catch (e) {}
    }

    function applyRiyadhGeometryState(state) {
        if (window.roadGeometryEdit && typeof window.roadGeometryEdit.applyStateSnapshot === 'function') {
            window.roadGeometryEdit.applyStateSnapshot(state);
        }
    }

    function applyFullState(state) {
        if (!state) {
            return;
        }

        isApplying = true;
        try {
            applyTerraDrawState(state.terradraw);
            applyRiyadhGeometryState(state.riyadh);
            if (window.lineDrawingHandler && typeof window.lineDrawingHandler.refreshAfterUndoRedo === 'function') {
                window.lineDrawingHandler.refreshAfterUndoRedo();
            }
            lastCommittedState = captureFullState();
        } finally {
            isApplying = false;
            resumeLinestringAfterApply = false;
        }
    }

    function trimStack(stack) {
        while (stack.length > MAX_STACK) {
            stack.shift();
        }
    }

    function pushUndoState(state) {
        if (!state) {
            return false;
        }
        if (undoStack.length > 0 && statesEqual(undoStack[undoStack.length - 1], state)) {
            return false;
        }
        undoStack.push(cloneState(state));
        trimStack(undoStack);
        redoStack = [];
        syncUndoRedoButtons();
        return true;
    }

    function recordBeforeEdit() {
        if (isApplying || !isEditModeActive()) {
            return;
        }
        pushUndoState(captureFullState());
    }

    function beginDrawSession() {
        if (!isEditModeActive()) {
            return;
        }
        flushChangeBurst();
        drawSessionBaseState = captureFullState();
        drawSessionUndoCount = 0;
        lastCommittedState = cloneState(drawSessionBaseState);
        syncUndoRedoButtons();
    }

    function collapseDrawSessionOnFinish() {
        if (drawSessionBaseState == null && drawSessionUndoCount === 0) {
            lastCommittedState = captureFullState();
            syncUndoRedoButtons();
            return;
        }

        while (drawSessionUndoCount > 0 && undoStack.length > 0) {
            undoStack.pop();
            drawSessionUndoCount--;
        }

        if (drawSessionBaseState) {
            pushUndoState(drawSessionBaseState);
        }

        drawSessionBaseState = null;
        drawSessionUndoCount = 0;
        lastCommittedState = captureFullState();
        redoStack = [];
        syncUndoRedoButtons();
    }

    function abandonDrawSession() {
        drawSessionBaseState = null;
        drawSessionUndoCount = 0;
    }

    function undo() {
        if (!isEditModeActive() || undoStack.length === 0 || isApplying) {
            return;
        }

        flushChangeBurst();
        resumeLinestringAfterApply = isLinestringDrawing();

        redoStack.push(captureFullState());
        trimStack(redoStack);
        var previous = undoStack.pop();
        if (drawSessionUndoCount > 0) {
            drawSessionUndoCount--;
        }
        applyFullState(previous);
        syncUndoRedoButtons();
    }

    function redo() {
        if (!isEditModeActive() || redoStack.length === 0 || isApplying) {
            return;
        }

        flushChangeBurst();
        resumeLinestringAfterApply = isLinestringDrawing();

        undoStack.push(captureFullState());
        trimStack(undoStack);
        if (drawSessionBaseState != null) {
            drawSessionUndoCount++;
        }
        applyFullState(redoStack.pop());
        syncUndoRedoButtons();
    }

    function setButtonState(btn, enabled) {
        if (!btn) {
            return;
        }
        btn.disabled = !enabled;
        btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        if (enabled) {
            btn.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
        } else {
            btn.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
        }
    }

    function syncUndoRedoButtons() {
        var editActive = isEditModeActive();
        setButtonState(document.getElementById('undoBtn'), editActive && undoStack.length > 0);
        setButtonState(document.getElementById('redoBtn'), editActive && redoStack.length > 0);
    }

    function clearHistory() {
        undoStack = [];
        redoStack = [];
        lastCommittedState = null;
        changeBurstOpen = false;
        abandonDrawSession();
        if (changeDebounceTimer) {
            clearTimeout(changeDebounceTimer);
            changeDebounceTimer = null;
        }
        syncUndoRedoButtons();
    }

    function onEditModeEntered() {
        lastCommittedState = captureFullState();
        abandonDrawSession();
        syncUndoRedoButtons();
    }

    function onEditModeExited() {
        clearHistory();
    }

    function flushChangeBurst() {
        if (changeDebounceTimer) {
            clearTimeout(changeDebounceTimer);
            changeDebounceTimer = null;
        }
        if (changeBurstOpen) {
            changeBurstOpen = false;
            lastCommittedState = captureFullState();
        }
    }

    function handleLinestringVertexChange() {
        var current = captureFullState();
        var prevCount = countLineVertices(lastCommittedState);
        var currCount = countLineVertices(current);

        // Rubber-band updates keep the same committed vertex count.
        if (currCount <= prevCount) {
            return;
        }

        if (drawSessionBaseState == null) {
            beginDrawSession();
            prevCount = countLineVertices(lastCommittedState);
            if (currCount <= prevCount) {
                return;
            }
        }

        if (lastCommittedState && pushUndoState(lastCommittedState)) {
            drawSessionUndoCount++;
        }
        lastCommittedState = current;
    }

    function handleTerraDrawChange() {
        if (isApplying || !isEditModeActive()) {
            return;
        }

        if (isLinestringDrawing()) {
            handleLinestringVertexChange();
            return;
        }

        if (!changeBurstOpen) {
            pushUndoState(lastCommittedState || captureFullState());
            changeBurstOpen = true;
        }

        if (changeDebounceTimer) {
            clearTimeout(changeDebounceTimer);
        }

        changeDebounceTimer = setTimeout(function() {
            changeBurstOpen = false;
            lastCommittedState = captureFullState();
            syncUndoRedoButtons();
        }, DEBOUNCE_MS);
    }

    function bindDrawListeners(drawApi) {
        if (!drawApi || drawListenersBound || typeof drawApi.on !== 'function') {
            return;
        }

        drawListenersBound = true;
        drawApi.on('change', handleTerraDrawChange);
        drawApi.on('finish', function() {
            if (isApplying || !isEditModeActive()) {
                return;
            }
            collapseDrawSessionOnFinish();
        });
    }

    function setupButtonListeners() {
        var undoBtn = document.getElementById('undoBtn');
        var redoBtn = document.getElementById('redoBtn');

        if (undoBtn && !undoBtn.dataset.undoBound) {
            undoBtn.dataset.undoBound = '1';
            undoBtn.addEventListener('click', function(event) {
                event.preventDefault();
                undo();
            });
        }

        if (redoBtn && !redoBtn.dataset.redoBound) {
            redoBtn.dataset.redoBound = '1';
            redoBtn.addEventListener('click', function(event) {
                event.preventDefault();
                redo();
            });
        }
    }

    function setupKeyboardShortcuts() {
        if (window.__mapEditUndoKeyboardBound) {
            return;
        }
        window.__mapEditUndoKeyboardBound = true;

        document.addEventListener('keydown', function(event) {
            if (!isEditModeActive()) {
                return;
            }

            var target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            var key = (event.key || '').toLowerCase();
            if (!(event.ctrlKey || event.metaKey) || key !== 'z') {
                return;
            }

            event.preventDefault();
            if (event.shiftKey) {
                redo();
            } else {
                undo();
            }
        });
    }

    function init() {
        if (!document.getElementById('editToolbar')) {
            return;
        }

        setupButtonListeners();
        setupKeyboardShortcuts();

        var drawApi = getDrawInstance();
        if (drawApi) {
            bindDrawListeners(drawApi);
            syncUndoRedoButtons();
            return;
        }

        initRetryCount++;
        if (initRetryCount < 80) {
            setTimeout(init, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.mapEditUndo = {
        recordBeforeEdit: recordBeforeEdit,
        beginDrawSession: beginDrawSession,
        onEditModeEntered: onEditModeEntered,
        onEditModeExited: onEditModeExited
    };
})();
