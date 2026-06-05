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

    function syncClearSelectionToolbar() {
        const toolbar = document.getElementById('clearSelectionToolbar');
        if (!toolbar) {
            return;
        }
        const show = hasActiveSelection();
        toolbar.hidden = !show;
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
        syncClearSelectionToolbar();
    }

    window.syncClearSelectionToolbar = syncClearSelectionToolbar;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initClearSelectionToolbar);
    } else {
        initClearSelectionToolbar();
    }
})();
