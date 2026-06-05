(function () {
    'use strict';

    function isLayerReviewPage() {
        return !!document.getElementById('layer-review-root');
    }

    function hasActiveSelection() {
        if (isLayerReviewPage()) {
            if (typeof window.hasLayerReviewFeatureSelection === 'function') {
                return window.hasLayerReviewFeatureSelection();
            }
            return false;
        }
        if (typeof window.hasMapRoadSelection === 'function') {
            return window.hasMapRoadSelection();
        }
        return false;
    }

    function clearActiveSelection() {
        if (isLayerReviewPage()) {
            if (typeof window.clearLayerReviewFeatureSelection === 'function') {
                window.clearLayerReviewFeatureSelection();
            }
            return;
        }
        if (typeof window.clearMapRoadSelection === 'function') {
            window.clearMapRoadSelection();
        }
    }

    var editToolbarResizeObserver = null;

    function isEditToolbarVisible() {
        const editToolbar = document.getElementById('editToolbar');
        return !!(editToolbar && !editToolbar.classList.contains('hidden'));
    }

    function syncClearSelectionPosition() {
        const mapContainer = document.getElementById('mapContainer');
        const editToolbar = document.getElementById('editToolbar');
        const toolbar = document.getElementById('clearSelectionToolbar');
        if (!toolbar || !mapContainer) {
            return;
        }

        if (isEditToolbarVisible() && editToolbar) {
            const editRect = editToolbar.getBoundingClientRect();
            const containerRect = mapContainer.getBoundingClientRect();
            const gapPx = 10;
            const topOffset = Math.max(0, editRect.bottom - containerRect.top + gapPx);
            toolbar.style.top = topOffset + 'px';
            mapContainer.classList.add('map-edit-toolbar-active');
            return;
        }

        toolbar.style.top = '';
        mapContainer.classList.remove('map-edit-toolbar-active');
    }

    function bindEditToolbarResizeObserver() {
        const editToolbar = document.getElementById('editToolbar');
        if (!editToolbar || editToolbarResizeObserver || typeof ResizeObserver === 'undefined') {
            return;
        }

        editToolbarResizeObserver = new ResizeObserver(function () {
            if (isEditToolbarVisible()) {
                syncClearSelectionPosition();
            }
        });
        editToolbarResizeObserver.observe(editToolbar);
    }

    function syncClearSelectionToolbar() {
        const toolbar = document.getElementById('clearSelectionToolbar');
        if (!toolbar) {
            return;
        }
        const show = hasActiveSelection();
        toolbar.hidden = !show;
        syncClearSelectionPosition();
    }

    function initClearSelectionToolbar() {
        const btn = document.getElementById('clearSelectionBtn');
        if (!btn || btn.getAttribute('data-bound') === '1') {
            return;
        }
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function () {
            clearActiveSelection();
            syncClearSelectionToolbar();
        });
        window.addEventListener('map:selectionChanged', syncClearSelectionToolbar);
        window.addEventListener('map:selectionCleared', syncClearSelectionToolbar);
        window.addEventListener('resize', syncClearSelectionPosition);
        bindEditToolbarResizeObserver();
        syncClearSelectionToolbar();
    }

    window.syncClearSelectionToolbar = syncClearSelectionToolbar;
    window.syncClearSelectionPosition = syncClearSelectionPosition;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initClearSelectionToolbar);
    } else {
        initClearSelectionToolbar();
    }
})();
