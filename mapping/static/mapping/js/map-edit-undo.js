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

    function getDrawInstance() {
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            return drawInstance;
        }
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.getDrawInstance === 'function') {
            return window.lineDrawingHandler.getDrawInstance();
        }
        if (typeof draw !== 'undefined' && draw && typeof draw.getTerraDrawInstance === 'function') {
            return draw.getTerraDrawInstance();
        }
        return null;
    }

    function isEditModeActive() {
        return typeof window.isMapEditModeActive === 'function' && window.isMapEditModeActive();
    }

    function filterDrawableFeatures(snapshot) {
        if (!Array.isArray(snapshot)) {
            return [];
        }
        return snapshot.filter(function(feature) {
            var props = feature && feature.properties;
            if (!props) {
                return true;
            }
            return !props.midPoint && !props.selectionPoint;
        });
    }

    function cloneState(state) {
        return JSON.parse(JSON.stringify(state));
    }

    function captureTerraDrawState() {
        var draw = getDrawInstance();
        if (!draw || typeof draw.getSnapshot !== 'function') {
            return [];
        }
        try {
            return cloneState(filterDrawableFeatures(draw.getSnapshot()));
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

    function applyTerraDrawState(features) {
        var draw = getDrawInstance();
        if (!draw) {
            return;
        }

        var target = Array.isArray(features) ? cloneState(features) : [];

        try {
            var mode = typeof draw.getMode === 'function' ? draw.getMode() : null;
            if (mode && mode !== 'static' && mode !== 'select' && typeof draw.setMode === 'function') {
                draw.setMode('select');
            }

            if (typeof draw.clear === 'function') {
                draw.clear();
            } else {
                var current = filterDrawableFeatures(draw.getSnapshot());
                current.forEach(function(feature) {
                    if (!feature || feature.id == null) {
                        return;
                    }
                    if (typeof draw.removeFeatures === 'function') {
                        draw.removeFeatures([feature.id]);
                    }
                });
            }

            if (target.length > 0 && typeof draw.addFeatures === 'function') {
                draw.addFeatures(target);
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
        }
    }

    function trimStack(stack) {
        while (stack.length > MAX_STACK) {
            stack.shift();
        }
    }

    function recordBeforeEdit() {
        if (isApplying || !isEditModeActive()) {
            return;
        }

        var current = captureFullState();
        if (undoStack.length > 0 && statesEqual(undoStack[undoStack.length - 1], current)) {
            return;
        }

        undoStack.push(current);
        trimStack(undoStack);
        redoStack = [];
        syncUndoRedoButtons();
    }

    function undo() {
        if (!isEditModeActive() || undoStack.length === 0 || isApplying) {
            return;
        }

        redoStack.push(captureFullState());
        trimStack(redoStack);
        var previous = undoStack.pop();
        applyFullState(previous);
        syncUndoRedoButtons();
    }

    function redo() {
        if (!isEditModeActive() || redoStack.length === 0 || isApplying) {
            return;
        }

        undoStack.push(captureFullState());
        trimStack(undoStack);
        var next = redoStack.pop();
        applyFullState(next);
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
        var undoBtn = document.getElementById('undoBtn');
        var redoBtn = document.getElementById('redoBtn');
        var editActive = isEditModeActive();
        setButtonState(undoBtn, editActive && undoStack.length > 0);
        setButtonState(redoBtn, editActive && redoStack.length > 0);
    }

    function clearHistory() {
        undoStack = [];
        redoStack = [];
        lastCommittedState = null;
        changeBurstOpen = false;
        if (changeDebounceTimer) {
            clearTimeout(changeDebounceTimer);
            changeDebounceTimer = null;
        }
        syncUndoRedoButtons();
    }

    function onEditModeEntered() {
        lastCommittedState = captureFullState();
        syncUndoRedoButtons();
    }

    function onEditModeExited() {
        clearHistory();
    }

    function handleTerraDrawChange() {
        if (isApplying || !isEditModeActive()) {
            return;
        }

        if (!changeBurstOpen) {
            var preState = lastCommittedState || captureFullState();
            if (undoStack.length === 0 || !statesEqual(undoStack[undoStack.length - 1], preState)) {
                undoStack.push(cloneState(preState));
                trimStack(undoStack);
                redoStack = [];
            }
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

    function bindDrawListeners(draw) {
        if (!draw || drawListenersBound) {
            return;
        }

        drawListenersBound = true;

        if (typeof draw.on === 'function') {
            draw.on('change', handleTerraDrawChange);
            draw.on('finish', function() {
                if (isApplying || !isEditModeActive()) {
                    return;
                }
                lastCommittedState = captureFullState();
                syncUndoRedoButtons();
            });
        }
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
            var meta = event.ctrlKey || event.metaKey;
            if (!meta || key !== 'z') {
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

        var draw = getDrawInstance();
        if (draw) {
            bindDrawListeners(draw);
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
        undo: undo,
        redo: redo,
        recordBeforeEdit: recordBeforeEdit,
        clearHistory: clearHistory,
        syncButtons: syncUndoRedoButtons,
        onEditModeEntered: onEditModeEntered,
        onEditModeExited: onEditModeExited
    };
})();
