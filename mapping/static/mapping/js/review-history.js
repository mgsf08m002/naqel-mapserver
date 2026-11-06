(function () {
    'use strict';

    var root = document.getElementById('review-history-root');
    if (!root) return;

    var apiUrl = root.getAttribute('data-api-url') || '/mapping/api/manager-review-history/';
    var mapBaseUrl = root.getAttribute('data-map-url') || '/manager/';

    var loadingEl = document.getElementById('review-history-loading');
    var emptyEl = document.getElementById('review-history-empty');
    var listEl = document.getElementById('review-history-list');
    var tableBodyEl = document.getElementById('review-history-table-body');
    var countEl = document.getElementById('review-history-count');
    var countValueEl = document.getElementById('review-history-count-value');
    var scopeRoot = document.getElementById('review-history-scope');
    var statusRoot = document.getElementById('review-history-status-filters');
    var categoryRoot = document.getElementById('review-history-category-filters');
    var startDateEl = document.getElementById('review-history-start-date');
    var endDateEl = document.getElementById('review-history-end-date');
    var clearBtn = document.getElementById('review-history-clear-filters');

    var activeScope = 'all';
    var activeStatus = '';
    var activeCategories = [];

    var CAT_FALLBACKS = {
        layer_upload: 'Layer Upload',
        delete_road: 'Delete Road',
        new_road: 'New Road',
        add_road_label: 'Add Road Label',
        change_road_label: 'Change Road Label',
        new_road_geometry: 'New Road Geometry',
        new_feature_type: 'New Feature Type',
        road_attribute_edit: 'Road Attribute Edit'
    };

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDate(iso) {
        if (typeof window.formatRiyadhDateTime === 'function') {
            return window.formatRiyadhDateTime(iso, '-');
        }
        return iso || '-';
    }

    function submitterLabel(item) {
        if (!item.requester) return '-';
        return item.requester.name || item.requester.username || '-';
    }

    function categoryLabel(item) {
        var key = String(item.request_category || '').trim();
        var fallback =
            item.request_category_label ||
            CAT_FALLBACKS[key] ||
            uiT('rh_edit_fallback', 'Edit');
        if (!key) {
            return fallback;
        }
        return uiT('approval_cat_' + key, fallback);
    }

    function statusLabel(status) {
        if (status === 'rejected') {
            return uiT('rh_status_rejected', 'Rejected');
        }
        if (status === 'approved') {
            return uiT('rh_status_approved', 'Approved');
        }
        return status;
    }

    function rejectionReasonText(item) {
        if (item.status !== 'rejected') {
            return '';
        }
        if (item.no_reason || !String(item.rejection_reason || '').trim()) {
            return uiT('reject_no_reason', 'No reason');
        }
        return String(item.rejection_reason).trim();
    }

    function startDateValue() {
        return startDateEl ? startDateEl.value : '';
    }

    function endDateValue() {
        return endDateEl ? endDateEl.value : '';
    }

    function buildApiUrl() {
        var params = new URLSearchParams();
        params.set('scope', activeScope);
        if (activeStatus) params.set('status', activeStatus);
        var start = startDateValue();
        var end = endDateValue();
        if (start) params.set('start_date', start);
        if (end) params.set('end_date', end);
        activeCategories.forEach(function (category) {
            params.append('category', category);
        });
        return apiUrl + (apiUrl.indexOf('?') >= 0 ? '&' : '?') + params.toString();
    }

    function hasActiveFilters() {
        return !!(
            activeScope !== 'all' ||
            activeStatus ||
            startDateValue() ||
            endDateValue() ||
            activeCategories.length
        );
    }

    function syncClearButton() {
        if (clearBtn) clearBtn.hidden = !hasActiveFilters();
    }

    function updateCount(count) {
        if (!countEl || !countValueEl) return;
        countValueEl.textContent = uiT('rh_count', '{n} edits').replace(
            '{n}',
            String(count)
        );
        countEl.hidden = false;
    }

    function setActiveChip(container, btn) {
        if (!container) return;
        container.querySelectorAll('.rh-chip').forEach(function (chip) {
            chip.classList.toggle('is-active', chip === btn);
        });
    }

    function syncCategoryChips() {
        if (!categoryRoot) return;
        var showAll = activeCategories.length === 0;
        categoryRoot.querySelectorAll('[data-category]').forEach(function (chip) {
            if (chip.hasAttribute('data-category-all')) {
                chip.classList.toggle('is-active', showAll);
                return;
            }
            var value = chip.getAttribute('data-category') || '';
            chip.classList.toggle('is-active', !showAll && activeCategories.indexOf(value) >= 0);
        });
    }

    function setViewState(state) {
        if (loadingEl) loadingEl.hidden = state !== 'loading';
        if (emptyEl) emptyEl.hidden = state !== 'empty';
        if (listEl) listEl.hidden = state !== 'list';
    }

    function clearAllFilters() {
        activeScope = 'all';
        activeStatus = '';
        activeCategories = [];

        if (scopeRoot) setActiveChip(scopeRoot, scopeRoot.querySelector('[data-scope="all"]'));
        if (statusRoot) setActiveChip(statusRoot, statusRoot.querySelector('[data-status=""]'));
        if (startDateEl) startDateEl.value = '';
        if (endDateEl) endDateEl.value = '';
        syncCategoryChips();
        syncClearButton();
        fetchItems();
    }

    function buildRow(item) {
        var clickable = item.can_open_on_map && item.map_road_id != null;
        var title =
            String(item.road_name || '').trim() ||
            uiT('unnamed_road', 'Unnamed Road');
        var status = item.status || 'approved';
        var featureType = String(item.current_feature_label || '').trim();
        if (featureType && typeof window.displayFeatureTypeLabel === 'function') {
            featureType = window.displayFeatureTypeLabel(featureType);
        }
        var subtitle = item.shapefile_name
            ? uiT('rh_layer_prefix', 'Layer: {name}').replace(
                  '{name}',
                  String(item.shapefile_name)
              )
            : featureType;
        var reason = rejectionReasonText(item);

        var row = document.createElement('div');
        row.className = 'rh-row' + (clickable ? ' is-clickable' : '');
        row.setAttribute('role', clickable ? 'button' : 'row');
        if (clickable) {
            row.setAttribute('tabindex', '0');
            row.setAttribute(
                'aria-label',
                uiT('rh_open_road_aria', 'Open approved road on map: {name}').replace(
                    '{name}',
                    title
                )
            );
        }

        row.innerHTML =
            '<div class="rh-row__road-cell">' +
            '<span class="rh-row__road">' +
            escapeHtml(title) +
            '</span>' +
            (subtitle && subtitle !== title
                ? '<span class="rh-row__sub">' + escapeHtml(subtitle) + '</span>'
                : '') +
            '</div>' +
            '<span class="rh-row__type">' +
            escapeHtml(categoryLabel(item)) +
            '</span>' +
            '<div class="rh-row__status-cell">' +
            '<span class="rh-row__status rh-row__status--' +
            escapeHtml(status) +
            '">' +
            escapeHtml(statusLabel(status)) +
            '</span>' +
            (reason
                ? '<span class="rh-row__reason" dir="auto" title="' +
                  escapeHtml(reason) +
                  '">' +
                  escapeHtml(reason) +
                  '</span>'
                : '') +
            '</div>' +
            '<span class="rh-row__date">' +
            formatDate(item.created_at) +
            '</span>' +
            '<span class="rh-row__submitter">' +
            escapeHtml(submitterLabel(item)) +
            '</span>';

        if (clickable) {
            function goToMap() {
                var sep = mapBaseUrl.indexOf('?') >= 0 ? '&' : '?';
                window.location.href =
                    mapBaseUrl +
                    sep +
                    'road=' +
                    encodeURIComponent(String(item.map_road_id));
            }
            row.addEventListener('click', goToMap);
            row.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    goToMap();
                }
            });
        }

        return row;
    }

    function renderList(items) {
        if (!tableBodyEl) return;
        tableBodyEl.innerHTML = '';
        items.forEach(function (item) {
            tableBodyEl.appendChild(buildRow(item));
        });
    }

    function showEmpty(message) {
        setViewState('empty');
        if (emptyEl && message) {
            var msg = emptyEl.querySelector('p');
            if (msg) msg.textContent = message;
        }
        updateCount(0);
    }

    function showList(items) {
        renderList(items);
        setViewState('list');
        updateCount(items.length);
    }

    function fetchItems() {
        setViewState('loading');

        fetch(buildApiUrl(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin'
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (result) {
                if (!result.ok || !result.data || !result.data.success) {
                    throw new Error('load_failed');
                }
                var items = result.data.requests || [];
                if (!items.length) {
                    showEmpty(uiT('rh_empty', 'No edits match these filters.'));
                    return;
                }
                showList(items);
            })
            .catch(function () {
                var emptyMsg = uiT('toast_couldnt_load', "Couldn't load");
                showEmpty(emptyMsg);
                if (countEl) countEl.hidden = true;
                if (window.notify && typeof window.notify.tryShow === 'function') {
                    window.notify.tryShow(emptyMsg, 'error');
                }
            });
    }

    if (scopeRoot) {
        scopeRoot.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-scope]');
            if (!btn) return;
            activeScope = btn.getAttribute('data-scope') || 'all';
            setActiveChip(scopeRoot, btn);
            syncClearButton();
            fetchItems();
        });
    }

    if (statusRoot) {
        statusRoot.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-status]');
            if (!btn) return;
            activeStatus = btn.getAttribute('data-status') || '';
            setActiveChip(statusRoot, btn);
            syncClearButton();
            fetchItems();
        });
    }

    if (categoryRoot) {
        categoryRoot.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-category]');
            if (!btn) return;

            if (btn.hasAttribute('data-category-all')) {
                activeCategories = [];
            } else {
                var value = btn.getAttribute('data-category') || '';
                if (!value) return;
                var index = activeCategories.indexOf(value);
                if (index >= 0) {
                    activeCategories.splice(index, 1);
                } else {
                    activeCategories.push(value);
                }
            }

            syncCategoryChips();
            syncClearButton();
            fetchItems();
        });
    }

    if (startDateEl) {
        startDateEl.addEventListener('change', function () {
            syncClearButton();
            fetchItems();
        });
    }
    if (endDateEl) {
        endDateEl.addEventListener('change', function () {
            syncClearButton();
            fetchItems();
        });
    }
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);

    syncCategoryChips();
    syncClearButton();
    fetchItems();
})();
