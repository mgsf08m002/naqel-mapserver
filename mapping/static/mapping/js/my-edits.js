(function () {
    'use strict';

    var root = document.getElementById('my-edits-root');
    if (!root) return;

    var apiUrl = root.getAttribute('data-api-url') || '/mapping/api/my-edit-requests/';
    var mapBaseUrl = root.getAttribute('data-map-url') || '/editor/';

    var loadingEl = document.getElementById('my-edits-loading');
    var emptyEl = document.getElementById('my-edits-empty');
    var listEl = document.getElementById('my-edits-list');
    var tableBodyEl = document.getElementById('my-edits-table-body');
    var countEl = document.getElementById('my-edits-count');
    var countValueEl = document.getElementById('my-edits-count-value');
    var statusRoot = document.getElementById('my-edits-status-filters');
    var categoryRoot = document.getElementById('my-edits-category-filters');
    var startDateEl = document.getElementById('my-edits-start-date');
    var endDateEl = document.getElementById('my-edits-end-date');
    var clearBtn = document.getElementById('my-edits-clear-filters');

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

    function reviewerLabel(item) {
        if (item.status === 'pending') return '-';
        if (!item.reviewer) return '-';
        return item.reviewer.name || item.reviewer.username || '-';
    }

    function categoryLabel(item) {
        var key = String(item.request_category || '').trim();
        var fallback =
            item.request_category_label ||
            CAT_FALLBACKS[key] ||
            uiT('me_edit_fallback', 'Edit');
        if (!key) {
            return fallback;
        }
        return uiT('approval_cat_' + key, fallback);
    }

    function statusLabel(status) {
        if (status === 'pending') {
            return uiT('me_status_pending', 'Pending');
        }
        if (status === 'rejected') {
            return uiT('me_status_rejected', 'Rejected');
        }
        if (status === 'approved') {
            return uiT('me_status_approved', 'Approved');
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
        if (activeStatus) params.set('status', activeStatus);
        var start = startDateValue();
        var end = endDateValue();
        if (start) params.set('start_date', start);
        if (end) params.set('end_date', end);
        activeCategories.forEach(function (category) {
            params.append('category', category);
        });
        var qs = params.toString();
        if (!qs) return apiUrl;
        return apiUrl + (apiUrl.indexOf('?') >= 0 ? '&' : '?') + qs;
    }

    function hasActiveFilters() {
        return !!(
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
        countValueEl.textContent = uiT('me_count', '{n} edits').replace(
            '{n}',
            String(count)
        );
        countEl.hidden = false;
    }

    function setActiveStatusChip(btn) {
        if (!statusRoot) return;
        statusRoot.querySelectorAll('.me-chip').forEach(function (chip) {
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
        activeStatus = '';
        activeCategories = [];

        if (statusRoot) {
            setActiveStatusChip(statusRoot.querySelector('[data-status=""]'));
        }
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
        var status = item.status || 'pending';
        var featureType = String(item.current_feature_label || '').trim();
        if (featureType && typeof window.displayFeatureTypeLabel === 'function') {
            featureType = window.displayFeatureTypeLabel(featureType);
        }
        var subtitle = item.shapefile_name
            ? uiT('me_layer_prefix', 'Layer: {name}').replace(
                  '{name}',
                  String(item.shapefile_name)
              )
            : featureType;
        var reason = rejectionReasonText(item);

        var row = document.createElement('div');
        row.className = 'me-row' + (clickable ? ' is-clickable' : '');
        row.setAttribute('role', clickable ? 'button' : 'row');
        if (clickable) {
            row.setAttribute('tabindex', '0');
            row.setAttribute(
                'aria-label',
                uiT('me_open_road_aria', 'Open approved road on map: {name}').replace(
                    '{name}',
                    title
                )
            );
        }

        row.innerHTML =
            '<div class="me-row__road-cell">' +
            '<span class="me-row__road">' +
            escapeHtml(title) +
            '</span>' +
            (subtitle && subtitle !== title
                ? '<span class="me-row__sub">' + escapeHtml(subtitle) + '</span>'
                : '') +
            '</div>' +
            '<span class="me-row__type">' +
            escapeHtml(categoryLabel(item)) +
            '</span>' +
            '<div class="me-row__status-cell">' +
            '<span class="me-row__status me-row__status--' +
            escapeHtml(status) +
            '">' +
            escapeHtml(statusLabel(status)) +
            '</span>' +
            (reason
                ? '<span class="me-row__reason" dir="auto" title="' +
                  escapeHtml(reason) +
                  '">' +
                  escapeHtml(reason) +
                  '</span>'
                : '') +
            '</div>' +
            '<span class="me-row__date">' +
            formatDate(item.created_at) +
            '</span>' +
            '<span class="me-row__reviewer">' +
            escapeHtml(reviewerLabel(item)) +
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
                    showEmpty(uiT('me_empty', 'No edits match these filters.'));
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

    if (statusRoot) {
        statusRoot.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-status]');
            if (!btn) return;
            activeStatus = btn.getAttribute('data-status') || '';
            setActiveStatusChip(btn);
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
