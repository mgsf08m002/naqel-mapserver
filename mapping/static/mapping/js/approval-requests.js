// Manager approval queue: header bell dropdown, API sync, map review, and approve/reject flow.
(function() {
    'use strict';

    let approvalQueue = [];
    let approvalFilterKey = 'all';

    const APPROVAL_ACTION_LABELS = {
        layer_upload: 'Review on map',
        delete_road: 'Review deletion',
        new_road: 'Review new road',
        new_road_geometry: 'Review geometry',
        new_feature_type: 'Review feature type',
        add_road_label: 'Review label',
        change_road_label: 'Review label',
        road_attribute_edit: 'Review attributes'
    };

    const ROW_CHEVRON_SVG =
        '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>' +
        '</svg>';

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function showToast(message, type) {
        if (message && window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(message, type || 'info');
        }
    }

    function toastApproveSuccess(data) {
        if (data && data.deleted_road_id != null) {
            return uiT('toast_road_deleted', 'Road deleted');
        }
        const msg = data && data.message ? String(data.message) : '';
        if (/layer/i.test(msg)) {
            return uiT('toast_layer_published', 'Layer published');
        }
        return uiT('toast_approved', 'Approved');
    }

    function toastRejectSuccess(data) {
        const msg = data && data.message ? String(data.message) : '';
        if (/layer/i.test(msg)) {
            return uiT('toast_layer_rejected', 'Layer rejected');
        }
        return uiT('toast_rejected', 'Rejected');
    }

    function approvalEmptyHtml() {
        return `
            <div class="approval-empty">
                <div class="approval-empty__icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                </div>
                <p class="approval-empty__title">You're all caught up</p>
                <p class="approval-empty__text">No editor submissions need your review right now.</p>
            </div>
        `;
    }

    function formatRequestTime(isoString) {
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) {
            return 'Just now';
        }
        if (diffMins < 60) {
            return diffMins + 'm ago';
        }
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) {
            return diffHours + 'h ago';
        }
        if (typeof window.formatRiyadhDate === 'function' && typeof window.formatRiyadhClock === 'function') {
            return window.formatRiyadhDate(isoString) + ', ' + window.formatRiyadhClock(isoString);
        }
        return '';
    }

    function approvalCategoryClass(categoryKey) {
        const key = categoryKey || 'road_attribute_edit';
        return 'approval-cat--' + key;
    }

    function getRequestTypeMeta(request) {
        const categoryKey = request.request_category || 'road_attribute_edit';
        return {
            key: categoryKey,
            label: request.request_category_label || 'Road Attribute Edit',
            categoryClass: approvalCategoryClass(categoryKey),
            actionLabel: APPROVAL_ACTION_LABELS[categoryKey] || 'Review'
        };
    }

    function getFilteredApprovalQueue() {
        if (approvalFilterKey === 'all') {
            return approvalQueue;
        }
        return approvalQueue.filter(function(request) {
            return (request.request_category || '') === approvalFilterKey;
        });
    }

    function syncApprovalFilterBar() {
        const bar = document.getElementById('approvalRequestsFilterBar');
        if (!bar) {
            return;
        }
        bar.querySelectorAll('[data-approval-filter]').forEach(function(btn) {
            const key = btn.getAttribute('data-approval-filter');
            const active = key === approvalFilterKey;
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function setApprovalPanelOpen(open) {
        const panel = document.getElementById('approvalRequestsPanel');
        const bell = document.getElementById('approvalRequestsBell');
        if (!panel) {
            return;
        }
        if (open) {
            panel.classList.add('approval-panel--open');
            if (bell) {
                bell.setAttribute('aria-expanded', 'true');
            }
            syncApprovalUI();
        } else {
            panel.classList.remove('approval-panel--open');
            if (bell) {
                bell.setAttribute('aria-expanded', 'false');
            }
            // Closing the bell list must not cancel an in-progress map review.
            syncApprovalUI();
        }
    }

    function isApprovalPanelOpen() {
        const panel = document.getElementById('approvalRequestsPanel');
        return panel && panel.classList.contains('approval-panel--open');
    }

    function setManagerReviewMode(active) {
        window.managerApprovalReviewActive = Boolean(active);
        const editToolbar = document.getElementById('editToolbar');
        if (editToolbar && active) {
            editToolbar.classList.add('hidden');
        }
        if (active && typeof window.hideRiyadhGeometryEditToolbar === 'function') {
            window.hideRiyadhGeometryEditToolbar();
        }
    }

    function hideEditToolbarsForReview() {
        setManagerReviewMode(true);
    }

    function wireApprovalDropdown() {
        const bellWrap = document.getElementById('approvalRequestsBellWrap');
        const bell = document.getElementById('approvalRequestsBell');
        const filterBar = document.getElementById('approvalRequestsFilterBar');
        if (!bellWrap || !bell) {
            return;
        }

        if (filterBar) {
            filterBar.querySelectorAll('[data-approval-filter]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    approvalFilterKey = btn.getAttribute('data-approval-filter') || 'all';
                    syncApprovalFilterBar();
                    renderApprovalList();
                });
            });
        }

        bell.addEventListener('click', function(event) {
            event.stopPropagation();
            const willOpen = !isApprovalPanelOpen();
            setApprovalPanelOpen(willOpen);
            if (willOpen) {
                refreshApprovalQueue();
            }
        });

        document.addEventListener('click', function(event) {
            if (!isApprovalPanelOpen()) {
                return;
            }
            if (bellWrap.contains(event.target)) {
                return;
            }
            setApprovalPanelOpen(false);
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && isApprovalPanelOpen()) {
                setApprovalPanelOpen(false);
            }
        });
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function buildApprovalRow(request) {
        const typeMeta = getRequestTypeMeta(request);
        const featureLabel = String(request.current_feature_label || 'Unnamed Road');
        const requesterName = String(request.requester_name || 'Unknown');
        const requesterRole = String(request.requester_role || 'Editor');
        const timeLabel = formatRequestTime(request.created_at);
        const shapefileLine =
            typeMeta.key === 'layer_upload' && request.shapefile_name
                ? '<div class="approval-row__meta-line">' +
                  '<span class="approval-row__meta-label">Shapefile:</span>' +
                  '<span class="approval-row__meta-value">' + escapeHtml(String(request.shapefile_name)) + '</span>' +
                  '</div>'
                : '';

        const card = document.createElement('article');
        card.className = 'approval-row ' + typeMeta.categoryClass;
        card.setAttribute('data-request-id', request.id);
        card.setAttribute('data-request-category', typeMeta.key);
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', typeMeta.actionLabel + ': ' + featureLabel);
        card.innerHTML =
            '<div class="approval-row__body">' +
            '<div class="approval-row__headline">' +
            '<span class="approval-row__title">' + escapeHtml(featureLabel) + '</span>' +
            '<time class="approval-row__time" datetime="' + escapeHtml(String(request.created_at || '')) + '">' +
            escapeHtml(timeLabel) +
            '</time></div>' +
            '<div class="approval-row__meta">' +
            '<div class="approval-row__meta-line">' +
            '<span class="approval-row__meta-label">User:</span>' +
            '<span class="approval-row__meta-value">' + escapeHtml(requesterName) + '</span>' +
            '</div>' +
            '<div class="approval-row__meta-line">' +
            '<span class="approval-row__meta-label">Role:</span>' +
            '<span class="approval-row__meta-value">' + escapeHtml(requesterRole) + '</span>' +
            '</div>' +
            '<div class="approval-row__meta-line">' +
            '<span class="approval-row__meta-label">Edit Type:</span>' +
            '<span class="approval-row__meta-value approval-row__meta-value--type">' +
            '<span class="approval-row__type-dot" aria-hidden="true"></span>' +
            escapeHtml(typeMeta.label) +
            '</span></div>' +
            shapefileLine +
            '</div></div>' +
            '<span class="approval-row__chevron" aria-hidden="true">' + ROW_CHEVRON_SVG + '</span>';

        card.addEventListener('click', function() {
            openApprovalRequest(request.id);
        });
        card.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openApprovalRequest(request.id);
            }
        });

        return card;
    }

    function syncApprovalUI() {
        const count = approvalQueue.length;
        const summary = document.getElementById('approvalRequestsPanelSummary');
        const countPill = document.getElementById('approvalRequestsPanelCount');
        const badge = document.getElementById('approvalRequestsBellBadge');
        const bell = document.getElementById('approvalRequestsBell');
        const filterBar = document.getElementById('approvalRequestsFilterBar');
        const filtered = getFilteredApprovalQueue();
        const shown = filtered.length;

        if (countPill) {
            countPill.textContent = count > 0 ? String(count) : '';
            countPill.setAttribute('data-count', String(count));
        }
        if (badge) {
            badge.textContent = String(count);
            badge.classList.toggle('approval-bell__badge--clear', count === 0);
            badge.classList.toggle('approval-bell__badge--pending', count > 0);
        }
        if (bell) {
            const label = count === 0
                ? '0 approval requests'
                : count === 1
                    ? '1 approval request'
                    : count + ' approval requests';
            bell.setAttribute('aria-label', label);
        }

        if (summary) {
            if (count === 0) {
                summary.textContent = 'Nothing pending review';
            } else if (approvalFilterKey !== 'all' && shown !== count) {
                summary.textContent = 'Showing ' + shown + ' of ' + count;
            } else if (count === 1) {
                summary.textContent = '1 submission awaiting review';
            } else {
                summary.textContent = count + ' submissions awaiting review';
            }
        }
        if (filterBar) {
            filterBar.classList.toggle('approval-panel__filters--visible', count > 0 && isApprovalPanelOpen());
            if (count > 0 && isApprovalPanelOpen()) {
                syncApprovalFilterBar();
            }
        }
    }

    // Convert WebMercator (EPSG:3857) coordinates to WGS84 lon/lat.
    function webMercatorToWgs84(x, y) {
        const R = 6378137.0;
        const lng = (x / R) * (180 / Math.PI);
        const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
        return [lng, lat];
    }

    // Normalize request.geometry into a clean LineString in WGS84.
    function normalizeRequestGeometry(geometry) {
        if (!geometry || !geometry.coordinates) {
            return null;
        }

        let coordinates = geometry.coordinates;

        // For MultiLineString, use the first line as the representative geometry.
        if (geometry.type === 'MultiLineString') {
            if (!Array.isArray(coordinates) || !coordinates.length) {
                return null;
            }
            coordinates = coordinates[0] || [];
        }

        if (!Array.isArray(coordinates)) {
            return null;
        }

        const cleaned = [];

        coordinates.forEach(function(coord) {
            if (!coord || coord.length < 2) {
                return;
            }

            let lng = Number(coord[0]);
            let lat = Number(coord[1]);

            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                return;
            }

            // If coordinates are clearly outside WGS84 bounds, assume they are
            // WebMercator and convert them on the fly so MapLibre never sees
            // invalid latitudes.
            if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
                const converted = webMercatorToWgs84(lng, lat);
                lng = converted[0];
                lat = converted[1];

                if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                    return;
                }

                if (lat < -90 || lat > 90) {
                    return;
                }
            }

            cleaned.push([lng, lat]);
        });

        if (cleaned.length < 2) {
            return null;
        }

        function bboxCenter(coords) {
            let minLng = coords[0][0];
            let minLat = coords[0][1];
            let maxLng = coords[0][0];
            let maxLat = coords[0][1];

            coords.forEach(function (pt) {
                minLng = Math.min(minLng, pt[0]);
                minLat = Math.min(minLat, pt[1]);
                maxLng = Math.max(maxLng, pt[0]);
                maxLat = Math.max(maxLat, pt[1]);
            });

            return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
        }

        function inRiyadhViewport(lng, lat) {
            // Keep in sync with the app’s configured map bounds (Riyadh area).
            return lng >= 45.475 && lng <= 48.733 && lat >= 23.981 && lat <= 25.664;
        }

        const center = bboxCenter(cleaned);
        if (!inRiyadhViewport(center.lng, center.lat) && inRiyadhViewport(center.lat, center.lng)) {
            for (let i = 0; i < cleaned.length; i++) {
                const pt = cleaned[i];
                cleaned[i] = [pt[1], pt[0]];
            }
        }

        return {
            type: 'LineString',
            coordinates: cleaned
        };
    }

    function toRad(d) {
        return d * Math.PI / 180;
    }

    function haversineMeters(a, b) {
        const R = 6371000;
        const dLat = toRad(b[1] - a[1]);
        const dLon = toRad(b[0] - a[0]);
        const la1 = toRad(a[1]);
        const la2 = toRad(b[1]);
        const h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function projectPointOnSegmentPlanar(p, a, b) {
        const x = p[0];
        const y = p[1];
        const x1 = a[0];
        const y1 = a[1];
        const x2 = b[0];
        const y2 = b[1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx === 0 && dy === 0) {
            return [x1, y1];
        }
        let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        return [x1 + t * dx, y1 + t * dy];
    }

    function minDistPointToPolylineMeters(p, lineCoords) {
        let minD = Infinity;
        for (let i = 0; i < lineCoords.length - 1; i++) {
            const proj = projectPointOnSegmentPlanar(p, lineCoords[i], lineCoords[i + 1]);
            const d = haversineMeters(p, proj);
            minD = Math.min(minD, d);
        }
        return minD;
    }

    /** Segments of the proposed line whose midpoints move more than thresholdMeters from the original */
    function buildChangedSegmentsGeoJson(beforeCoords, afterCoords, thresholdMeters) {
        const thr = typeof thresholdMeters === 'number' ? thresholdMeters : 2.5;
        if (!beforeCoords || !afterCoords || beforeCoords.length < 2 || afterCoords.length < 2) {
            return null;
        }
        const lines = [];
        for (let i = 0; i < afterCoords.length - 1; i++) {
            const mid = [
                (afterCoords[i][0] + afterCoords[i + 1][0]) / 2,
                (afterCoords[i][1] + afterCoords[i + 1][1]) / 2
            ];
            if (minDistPointToPolylineMeters(mid, beforeCoords) > thr) {
                lines.push([afterCoords[i], afterCoords[i + 1]]);
            }
        }
        if (!lines.length) {
            return null;
        }
        return {
            type: 'MultiLineString',
            coordinates: lines
        };
    }

    function refreshApprovalQueue() {
        fetch('/mapping/api/pending-requests/', {
            method: 'GET',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            if (data.success) {
                approvalQueue = data.requests;
                renderApprovalList();
            }
        })
        .catch(function() {});
    }

    function renderApprovalList() {
        const requestsList = document.getElementById('approvalRequestsList');
        if (!requestsList) {
            return;
        }

        requestsList.innerHTML = '';

        const filtered = getFilteredApprovalQueue();

        if (approvalQueue.length === 0) {
            requestsList.innerHTML = approvalEmptyHtml();
            syncApprovalUI();
            return;
        }

        if (filtered.length === 0) {
            requestsList.innerHTML = '<p class="approval-empty-filter">No requests match this filter.</p>';
            syncApprovalUI();
            return;
        }

        filtered.forEach(function(request) {
            requestsList.appendChild(buildApprovalRow(request));
        });
        syncApprovalUI();
    }

    function openApprovalRequest(requestId) {
        fetch('/mapping/api/request/' + requestId + '/', {
            method: 'GET',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            if (data && data.success) {
                showEditRequestOnMap(data.request);
            } else {
                showToast(
                    uiT('toast_couldnt_load_request', "Couldn't load request"),
                    'error'
                );
            }
        })
        .catch(function() {
            showToast(
                uiT('toast_couldnt_load_request', "Couldn't load request"),
                'error'
            );
        });
    }

    function removeOneRequestCompareSet(featureId) {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        try {
            const mainLayers = [
                'request-line-layer-' + featureId,
                'request-line-ring-' + featureId,
                'request-line-outline-' + featureId,
            ];
            mainLayers.forEach(function(lid) {
                if (map.getLayer(lid)) {
                    map.removeLayer(lid);
                }
            });
            const mainSrc = 'request-line-source-' + featureId;
            if (map.getSource(mainSrc)) {
                map.removeSource(mainSrc);
            }
        } catch (e0) {}

        const triplets = [
            ['request-line-before-layer-', 'request-line-before-underlay-', 'request-line-before-source-'],
            ['request-line-diff-layer-', 'request-line-diff-underlay-', 'request-line-diff-source-']
        ];
        triplets.forEach(function(t) {
            const layerId = t[0] + featureId;
            const underlayLayerId = t[1] + featureId;
            const sourceId = t[2] + featureId;
            try {
                if (map.getLayer(layerId)) {
                    map.removeLayer(layerId);
                }
                if (map.getLayer(underlayLayerId)) {
                    map.removeLayer(underlayLayerId);
                }
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch (e) {}
        });
    }

    // Remove any previously drawn request features and markers from the map.
    function cleanupRequestLines() {
        if (typeof map === 'undefined' || !map) {
            return;
        }
        if (!window.viewingRequestIds || !window.viewingRequestIds.length) {
            return;
        }
        window.viewingRequestIds.forEach(function (featureId) {
            removeOneRequestCompareSet(featureId);
        });
        window.viewingRequestIds = [];
    }

    // Zoom the map to the request geometry, draw it, and open the details UI.
    function showEditRequestOnMap(request) {
        if (typeof map === 'undefined' || !map) {
            showToast(uiT('toast_map_not_ready', "Map isn't ready"), 'error');
            return;
        }

        cleanupRequestLines();
        removeApproveRejectButtons();
        setApprovalPanelOpen(false);
        hideEditToolbarsForReview();
        
        const normalizedGeometry = normalizeRequestGeometry(request.geometry);
        if (!normalizedGeometry || !normalizedGeometry.coordinates || normalizedGeometry.coordinates.length < 2) {
            showToast(
                uiT(
                    'toast_cant_show_on_map',
                    "Can't show on map — details still available"
                ),
                'warning'
            );

            ensureSidePanelForReview(function() {
                try {
                    populateSidepanelWithRequestData(request);
                } catch (ePop) {}
                createApproveRejectButtons(request);
            });
            return;
        }

        const requestForMap = Object.assign({}, request, { geometry: normalizedGeometry });

        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;

        function expandBoundsFromLineString(line) {
            if (!line || !line.coordinates) {
                return;
            }
            line.coordinates.forEach(function(coord) {
                minLng = Math.min(minLng, coord[0]);
                minLat = Math.min(minLat, coord[1]);
                maxLng = Math.max(maxLng, coord[0]);
                maxLat = Math.max(maxLat, coord[1]);
            });
        }

        expandBoundsFromLineString(normalizedGeometry);
        const normBefore =
            request.original_geometry && request.geometry_changed
                ? normalizeRequestGeometry(request.original_geometry)
                : null;
        expandBoundsFromLineString(normBefore);

        if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
            showToast(uiT('toast_cant_find_on_map', "Can't find on map"), 'warning');
            ensureSidePanelForReview(function () {
                try {
                    populateSidepanelWithRequestData(requestForMap);
                } catch (ePop) {}
                createApproveRejectButtons(request);
            });
            return;
        }

        const bounds = [[minLng, minLat], [maxLng, maxLat]];

        map.fitBounds(bounds, {
            padding: 100,
            duration: 1000
        });
        ensureSidePanelForReview(function() {
            setTimeout(function() {
                drawRequestLineOnMap(requestForMap);
                try {
                    populateSidepanelWithRequestData(requestForMap);
                } catch (ePop) {}
                createApproveRejectButtons(request);
                hideEditToolbarsForReview();
            }, 1100);
        });
    }

    // Open the side panel for read-only review (no draw/edit toolbar).
    function ensureSidePanelForReview(callback) {
        const sidePanel = document.getElementById('editSidePanel');

        hideEditToolbarsForReview();

        if (!sidePanel) {
            if (callback) {
                setTimeout(callback, 100);
            }
            return;
        }

        const isCurrentlyActive = !sidePanel.classList.contains('-translate-x-full');
        if (isCurrentlyActive) {
            if (callback) {
                setTimeout(callback, 100);
            }
            return;
        }
        if (typeof window.initMapSidePanelChrome === 'function') {
            window.initMapSidePanelChrome();
        }
        if (typeof window.applyMapSidePanelOpen === 'function') {
            window.applyMapSidePanelOpen(true);
        } else {
            sidePanel.classList.remove('-translate-x-full');
        }
        setTimeout(function() {
            hideEditToolbarsForReview();
            if (callback) {
                callback();
            }
        }, 400);
    }

    function renderBeforeRequestLine(featureId, geometry) {
        if (typeof map === 'undefined' || !map) return;

        const sourceId = 'request-line-before-source-' + featureId;
        const underlayLayerId = 'request-line-before-underlay-' + featureId;
        const layerId = 'request-line-before-layer-' + featureId;

        try {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getLayer(underlayLayerId)) map.removeLayer(underlayLayerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);

            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'Feature', geometry: geometry }
            });
            map.addLayer({
                id: underlayLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#d1d5db',
                    'line-width': 12,
                    'line-opacity': 0.4,
                    'line-blur': 5
                }
            });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#6b7280',
                    'line-width': 4,
                    'line-opacity': 0.95,
                    'line-dasharray': [1.2, 1.2]
                }
            });
        } catch (error) {}
    }

    function renderDiffRequestLine(featureId, multiLineGeometry) {
        if (typeof map === 'undefined' || !map || !multiLineGeometry) return;

        const sourceId = 'request-line-diff-source-' + featureId;
        const underlayLayerId = 'request-line-diff-underlay-' + featureId;
        const layerId = 'request-line-diff-layer-' + featureId;

        try {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getLayer(underlayLayerId)) map.removeLayer(underlayLayerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);

            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'Feature', geometry: multiLineGeometry }
            });
            map.addLayer({
                id: underlayLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#fdba74',
                    'line-width': 14,
                    'line-opacity': 0.55,
                    'line-blur': 5
                }
            });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#ea580c',
                    'line-width': 6,
                    'line-opacity': 1
                }
            });
        } catch (error) {}
    }

    function renderRequestCompareOnMap(featureId, request) {
        const normAfter = normalizeRequestGeometry(request.geometry);
        if (!normAfter) {
            return;
        }
        const styledAfter = Object.assign({}, request, { geometry: normAfter });

        const normBefore =
            request.original_geometry && request.geometry_changed
                ? normalizeRequestGeometry(request.original_geometry)
                : null;

        if (normBefore && request.geometry_changed) {
            renderBeforeRequestLine(featureId, normBefore);
        }

        renderRequestLineAsMapLibreLayer(featureId, styledAfter);

        if (normBefore && normAfter.coordinates && normBefore.coordinates && request.geometry_changed) {
            const diffGeom = buildChangedSegmentsGeoJson(
                normBefore.coordinates,
                normAfter.coordinates,
                2.5
            );
            if (diffGeom) {
                renderDiffRequestLine(featureId, diffGeom);
            }
        }
    }

    // Draw the request line on the map as a MapLibre layer (before / after / diff when applicable).
    function drawRequestLineOnMap(request) {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        const featureId = 'request-' + request.id;
        renderRequestCompareOnMap(featureId, request);
        
        // Update feature label
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
            window.lineDrawingHandler.updateCurrentFeatureLabel(request.current_feature_label || 'Unnamed Road');
        }
        if (!window.viewingRequestIds) {
            window.viewingRequestIds = [];
        }
        window.viewingRequestIds.push(featureId);
    }

    // Add the GeoJSON source and styled line layers for the current request.
    function renderRequestLineAsMapLibreLayer(featureId, request) {
        if (typeof map === 'undefined' || !map) return;

        const sourceId = 'request-line-source-' + featureId;
        const outlineLayerId = 'request-line-outline-' + featureId;
        const ringLayerId = 'request-line-ring-' + featureId;
        const layerId = 'request-line-layer-' + featureId;

        const isRoadClosed =
            typeof window.parseRoadClosurePayloadValue === "function" &&
            window.parseRoadClosurePayloadValue(request.road_closure);
        const closureLabel =
            (window.RoadClosure && window.RoadClosure.FEATURE_LABEL) || "Road Closure";
        const getStyle = window.getVisualizationStyle;
        const closureStyle = typeof getStyle === "function" ? getStyle(closureLabel) : null;
        const featureStyle = typeof getStyle === "function" ? getStyle(request.current_feature_label || "Unnamed Road") : null;
        const style = (isRoadClosed && closureStyle) ? closureStyle : featureStyle;
        if (!style) {
            return;
        }

        const lineDasharray = (style.lineDasharray && Array.isArray(style.lineDasharray)) ? style.lineDasharray : [1, 0];

        var mls = window.MapLineSelection;
        if (!mls) {
            return;
        }
        var paintLabel = isRoadClosed
            ? closureLabel
            : request.current_feature_label || "Unnamed Road";
        var corePaint = mls.buildEditingCorePaint(style, lineDasharray, paintLabel);
        var pair = isRoadClosed
            ? null
            : mls.maplibreSelectionCasingPaintPair(style.lineWidth, lineDasharray);

        try {
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getLayer(ringLayerId)) {
                map.removeLayer(ringLayerId);
            }
            if (map.getLayer(outlineLayerId)) {
                map.removeLayer(outlineLayerId);
            }
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: request.geometry
                }
            });
            if (pair) {
                map.addLayer({
                    id: outlineLayerId,
                    type: 'line',
                    source: sourceId,
                    paint: pair.outline
                });
                map.addLayer({
                    id: ringLayerId,
                    type: 'line',
                    source: sourceId,
                    paint: pair.ring
                });
            }
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: {
                    'line-cap': isRoadClosed ? 'butt' : 'round',
                    'line-join': 'round'
                },
                paint: corePaint
            });
        } catch (error) {}
    }

    // Open the road panel for read-only review and fill label / closure fields.
    function populateSidepanelWithRequestData(request) {
        const sidePanel = document.getElementById('editSidePanel');
        hideEditToolbarsForReview();
        if (!sidePanel) {
            return;
        }

        if (sidePanel.classList.contains('-translate-x-full')) {
            if (typeof window.initMapSidePanelChrome === 'function') {
                window.initMapSidePanelChrome();
            }
            if (typeof window.applyMapSidePanelOpen === 'function') {
                window.applyMapSidePanelOpen(true);
            } else {
                sidePanel.classList.remove('-translate-x-full');
            }
        }

        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
            window.lineDrawingHandler.updateCurrentFeatureLabel(
                request.current_feature_label || 'Unnamed Road'
            );
        }

        function fillReviewFields() {
            hideEditToolbarsForReview();
            if (request.fields_data) {
                populateFieldsData(request.fields_data);
            }
        }

        setTimeout(function () {
            if (
                window.lineDrawingHandler &&
                typeof window.lineDrawingHandler.showEditFeatureScreen === 'function'
            ) {
                window.lineDrawingHandler.showEditFeatureScreen({
                    hideBackButton: true,
                    requestGeometry: request.geometry,
                    lineData: { road_closure: request.road_closure },
                });
            }
            setTimeout(fillReviewFields, 50);
        }, 50);
    }

    // Fill the road-label field from request.fields_data.
    function populateFieldsData(fieldsData) {
        if (!fieldsData) {
            return;
        }
        if (
            window.RiyadhRoadShared &&
            typeof window.RiyadhRoadShared.fillRoadLabelInputFromFields === 'function'
        ) {
            window.RiyadhRoadShared.fillRoadLabelInputFromFields(fieldsData);
        }
        if (typeof window.syncRoadPanelEditModeUI === 'function') {
            window.syncRoadPanelEditModeUI();
        }
    }

    // Create the Approve / Reject floating buttons for the active request.
    function createApproveRejectButtons(request) {
        removeApproveRejectButtons();
        setManagerReviewMode(true);

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'approveRejectButtonsContainer';
        buttonContainer.className = 'fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex gap-3 items-center';
        buttonContainer.style.pointerEvents = 'auto';
        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-2xl border border-gray-300 px-4 py-3 flex flex-wrap gap-3 items-center max-w-lg';
        card.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.2)';
        const infoText = document.createElement('span');
        infoText.className = 'text-sm font-medium text-gray-800 mr-2';
        infoText.textContent = 'Review: ' + (request.request_category_label || 'Road Edit');
        card.appendChild(infoText);
        const approveBtn = document.createElement('button');
        approveBtn.id = 'approveRequestBtn';
        approveBtn.className = 'px-4 py-2 bg-geotrak text-white rounded-md hover:bg-geotrak-hover transition-colors text-sm font-medium flex items-center justify-center gap-2 shadow-md';
        approveBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            Approve
        `;
        approveBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            approveRequest(request.id);
        });
        card.appendChild(approveBtn);
        const rejectBtn = document.createElement('button');
        rejectBtn.id = 'rejectRequestBtn';
        rejectBtn.className = 'px-4 py-2 bg-white text-geotrak border border-gray-300 rounded-md hover:bg-gray-100 transition-colors text-sm font-medium flex items-center justify-center gap-2 shadow-md';
        rejectBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            Reject
        `;
        rejectBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const runReject = function () {
                rejectRequest(request.id);
            };
            if (window.notify && typeof window.notify.confirm === 'function') {
                window.notify
                    .confirm({
                        title: 'Reject request',
                        message: 'Are you sure you want to reject this approval request?',
                        confirmLabel: 'Reject',
                        cancelLabel: 'Cancel',
                        variant: 'danger',
                    })
                    .then(function (ok) {
                        if (ok) {
                            runReject();
                        }
                    });
                return;
            }
            if (window.confirm('Reject this approval request?')) {
                runReject();
            }
        });
        card.appendChild(rejectBtn);

        if (request.geometry_changed && request.original_geometry) {
            const legend = document.createElement('div');
            legend.className = 'text-[11px] text-gray-600 flex flex-col gap-1 border-t border-gray-200 pt-2 mt-1';
            legend.innerHTML = '<span><span class="font-medium text-gray-600">━━</span> Gray dashed: original</span>'
                + '<span><span class="font-medium text-geotrak">━━</span> Solid: proposed</span>'
                + '<span><span class="font-medium text-orange-600">━━</span> Orange: changed segments</span>';
            card.appendChild(legend);
        }

        buttonContainer.appendChild(card);
        document.body.appendChild(buttonContainer);
        window.currentReviewingRequestId = request.id;
        try {
            window.dispatchEvent(new CustomEvent('map:selectionChanged'));
        } catch (eSel) {}
    }

    function removeApproveRejectButtons() {
        const container = document.getElementById('approveRejectButtonsContainer');
        if (container) {
            container.remove();
        }
        window.currentReviewingRequestId = null;
        setManagerReviewMode(false);
    }

    function approveRequest(requestId) {
        fetch('/mapping/api/request/' + requestId + '/approve/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
        .then(function(response) {
            return response.json().then(function(data) {
                return { ok: response.ok, data: data };
            });
        })
        .then(function(result) {
            const data = result.data || {};
            if (result.ok && data.success) {
                showToast(toastApproveSuccess(data), 'success');
                cleanupRequestLines();
                if (typeof window.clearDraftLineDrawingFromMap === 'function') {
                    window.clearDraftLineDrawingFromMap();
                }
                removeApproveRejectButtons();
                approvalQueue = approvalQueue.filter(function(req) {
                    return req.id !== requestId;
                });
                renderApprovalList();
                if (data.deleted_road_id != null) {
                    try {
                        window.selectedRiyadhRoad = null;
                        window.approvedLineBeingEdited = null;
                        if (typeof window.setSelectedOverlayGeometry === 'function') {
                            window.setSelectedOverlayGeometry(null);
                        }
                    } catch (eSel) {}
                }
                window.runRiyadhRoadSaveMapTransition(function () {
                    if (typeof window.applyRiyadhNetworkMutationResponse === 'function') {
                        window.applyRiyadhNetworkMutationResponse(data, null);
                    }
                });
                try {
                    window.dispatchEvent(new CustomEvent('pendingRoadLocks:refresh'));
                } catch (eLock) {}
            } else {
                showToast(
                    (typeof window.safeUserMessage === 'function'
                        ? window.safeUserMessage(
                              data,
                              uiT('toast_couldnt_approve', "Couldn't approve")
                          )
                        : uiT('toast_couldnt_approve', "Couldn't approve")),
                    'error'
                );
            }
        })
        .catch(function() {
            showToast(uiT('toast_couldnt_approve', "Couldn't approve"), 'error');
        });
    }

    function rejectRequest(requestId) {
        fetch('/mapping/api/request/' + requestId + '/reject/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        })
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            if (data.success) {
                showToast(toastRejectSuccess(data), 'success');
                cleanupRequestLines();
                removeApproveRejectButtons();
                approvalQueue = approvalQueue.filter(function(req) {
                    return req.id !== requestId;
                });
                renderApprovalList();
                try {
                    window.dispatchEvent(new CustomEvent('pendingRoadLocks:refresh'));
                } catch (eLock) {}
            } else {
                showToast(
                    (typeof window.safeUserMessage === 'function'
                        ? window.safeUserMessage(
                              data,
                              uiT('toast_couldnt_reject', "Couldn't reject")
                          )
                        : uiT('toast_couldnt_reject', "Couldn't reject")),
                    'error'
                );
            }
        })
        .catch(function() {
            showToast(uiT('toast_couldnt_reject', "Couldn't reject"), 'error');
        });
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

    function initApprovalRequests() {
        wireApprovalDropdown();
        refreshApprovalQueue();
        setInterval(refreshApprovalQueue, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApprovalRequests);
    } else {
        initApprovalRequests();
    }

    window.clearApprovalRequestMapOverlay = function () {
        cleanupRequestLines();
        removeApproveRejectButtons();
    };

    window.refreshApprovalQueue = refreshApprovalQueue;
    window.populateFieldsData = populateFieldsData;

})();

