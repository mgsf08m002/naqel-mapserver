(function () {
    'use strict';

    var root = document.getElementById('my-edits-root');
    if (!root) return;

    var apiUrl = root.getAttribute('data-api-url') || '/mapping/api/my-edit-requests/';
    var mapBaseUrl = root.getAttribute('data-map-url') || '/editor/';

    var loadingEl = document.getElementById('my-edits-loading');
    var emptyEl = document.getElementById('my-edits-empty');
    var listEl = document.getElementById('my-edits-list');
    var statusRoot = document.getElementById('my-edits-status-filters');
    var categoryRoot = document.getElementById('my-edits-category-filters');

    var activeStatus = '';
    var activeCategory = '';

    var CATEGORY_STYLES = {
        new_road: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
        add_road_label: 'bg-teal-50 text-teal-800 ring-teal-200/80',
        change_road_label: 'bg-orange-50 text-orange-900 ring-orange-200/80',
        new_road_geometry: 'bg-indigo-50 text-indigo-800 ring-indigo-200/80',
        new_feature_type: 'bg-violet-50 text-violet-800 ring-violet-200/80',
        delete_road: 'bg-rose-50 text-rose-800 ring-rose-200/80',
        layer_upload: 'bg-sky-50 text-sky-800 ring-sky-200/80',
        road_attribute_edit: 'bg-amber-50 text-amber-900 ring-amber-200/80'
    };

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
                year: 'numeric',
                month: 'short',
                day: 'numeric',
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
        return escapeHtml(item.reviewer.name || item.reviewer.username);
    }

    function buildApiUrl() {
        var params = new URLSearchParams();
        if (activeStatus) params.set('status', activeStatus);
        if (activeCategory) params.set('category', activeCategory);
        var qs = params.toString();
        if (!qs) return apiUrl;
        return apiUrl + (apiUrl.indexOf('?') >= 0 ? '&' : '?') + qs;
    }

    function buildRow(item) {
        var catKey = item.request_category || 'road_attribute_edit';
        var catClass = CATEGORY_STYLES[catKey] || CATEGORY_STYLES.road_attribute_edit;
        var clickable = item.can_open_on_map && item.map_road_id != null;
        var title = item.road_name || item.current_feature_label || 'Unnamed Road';
        var status = item.status || 'pending';

        var row = document.createElement('article');
        row.className = 'my-edits-row' + (clickable ? ' is-clickable' : '');
        row.setAttribute('role', clickable ? 'button' : 'listitem');
        if (clickable) {
            row.setAttribute('tabindex', '0');
            row.setAttribute('aria-label', 'Open approved road on map: ' + title);
        }

        var subtitle = item.shapefile_name
            ? 'Layer: ' + escapeHtml(item.shapefile_name)
            : escapeHtml(item.current_feature_label || '');

        row.innerHTML =
            '<div class="min-w-0">' +
            '<p class="text-sm font-semibold text-gray-900 truncate">' + escapeHtml(title) + '</p>' +
            '<div class="my-edits-row-meta">' +
            '<span class="my-edits-category-badge ring-1 ' + catClass + '">' +
            escapeHtml(item.request_category_label || 'Edit') +
            '</span>' +
            '<span>Submitted ' + formatDate(item.created_at) + '</span>' +
            (subtitle ? '<span class="text-gray-400">·</span><span>' + subtitle + '</span>' : '') +
            '</div>' +
            '</div>' +
            '<div class="text-right text-xs text-gray-500 sm:order-3">' +
            '<span class="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Reviewer</span>' +
            '<span class="font-medium text-gray-700">' + reviewerLabel(item) + '</span>' +
            (item.reviewed_at ? '<span class="block mt-0.5 text-gray-400">' + formatDate(item.reviewed_at) + '</span>' : '') +
            '</div>' +
            '<div class="flex justify-end sm:order-2">' +
            '<span class="my-edits-status-pill my-edits-status-pill--' + escapeHtml(status) + '">' +
            escapeHtml(status) +
            '</span>' +
            '</div>';

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
        listEl.innerHTML = '';
        items.forEach(function (item) {
            listEl.appendChild(buildRow(item));
        });
    }

    function showEmpty() {
        loadingEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        listEl.classList.add('hidden');
    }

    function showList(items) {
        loadingEl.classList.add('hidden');
        emptyEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        renderList(items);
    }

    function setActiveChip(container, btn) {
        if (!container) return;
        container.querySelectorAll('.my-edits-filter-chip').forEach(function (chip) {
            chip.classList.toggle('is-active', chip === btn);
        });
    }

    function fetchItems() {
        loadingEl.classList.remove('hidden');
        emptyEl.classList.add('hidden');
        listEl.classList.add('hidden');

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
                    showEmpty();
                    return;
                }
                showList(items);
            })
            .catch(function (err) {
                loadingEl.classList.add('hidden');
                emptyEl.classList.remove('hidden');
                emptyEl.querySelector('p').textContent = 'Could not load edits';
                var sub = emptyEl.querySelector('p + p');
                if (sub) sub.textContent = err.message || 'Please try again later.';
            });
    }

    if (statusRoot) {
        statusRoot.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-status]');
            if (!btn) return;
            activeStatus = btn.getAttribute('data-status') || '';
            setActiveChip(statusRoot, btn);
            fetchItems();
        });
    }

    if (categoryRoot) {
        categoryRoot.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-category]');
            if (!btn) return;
            activeCategory = btn.getAttribute('data-category') || '';
            setActiveChip(categoryRoot, btn);
            fetchItems();
        });
    }

    fetchItems();
})();
