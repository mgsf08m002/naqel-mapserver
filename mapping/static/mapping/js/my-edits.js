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

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDate(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            return d.toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return iso;
        }
    }

    function reviewerLabel(item) {
        if (item.status === 'pending') return '—';
        if (!item.reviewer) return '—';
        return item.reviewer.name || item.reviewer.username;
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
        countValueEl.textContent = String(count);
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
        var title = item.road_name || item.current_feature_label || 'Unnamed Road';
        var status = item.status || 'pending';
        var subtitle = item.shapefile_name
            ? 'Layer: ' + item.shapefile_name
            : (item.current_feature_label || '');

        var row = document.createElement('div');
        row.className = 'me-row' + (clickable ? ' is-clickable' : '');
        row.setAttribute('role', clickable ? 'button' : 'row');
        if (clickable) {
            row.setAttribute('tabindex', '0');
            row.setAttribute('aria-label', 'Open approved road on map: ' + title);
        }

        row.innerHTML =
            '<div class="me-row__road-cell">' +
            '<span class="me-row__road">' + escapeHtml(title) + '</span>' +
            (subtitle && subtitle !== title
                ? '<span class="me-row__sub">' + escapeHtml(subtitle) + '</span>'
                : '') +
            '</div>' +
            '<span class="me-row__type">' + escapeHtml(item.request_category_label || 'Edit') + '</span>' +
            '<span class="me-row__status me-row__status--' + escapeHtml(status) + '">' +
            escapeHtml(status) +
            '</span>' +
            '<span class="me-row__date">' + formatDate(item.created_at) + '</span>' +
            '<span class="me-row__reviewer">' + escapeHtml(reviewerLabel(item)) + '</span>';

        if (clickable) {
            function goToMap() {
                var sep = mapBaseUrl.indexOf('?') >= 0 ? '&' : '?';
                window.location.href = mapBaseUrl + sep + 'road=' + encodeURIComponent(String(item.map_road_id));
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
                    throw new Error(
                        (result.data && result.data.message) || 'Could not load edits.'
                    );
                }
                var items = result.data.requests || [];
                if (!items.length) {
                    showEmpty('No edits match these filters.');
                    return;
                }
                showList(items);
            })
            .catch(function (err) {
                showEmpty(err.message || 'Could not load edits.');
                if (countEl) countEl.hidden = true;
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

    if (startDateEl) startDateEl.addEventListener('change', function () {
        syncClearButton();
        fetchItems();
    });
    if (endDateEl) endDateEl.addEventListener('change', function () {
        syncClearButton();
        fetchItems();
    });
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);

    syncCategoryChips();
    syncClearButton();
    fetchItems();
})();
