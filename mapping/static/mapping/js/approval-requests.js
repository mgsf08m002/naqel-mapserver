// Manager approval queue: header bell dropdown, API sync, map review, and approve/reject flow.
(function() {
    'use strict';

    let approvalQueue = [];
    let approvalFilterKey = 'all';

    const APPROVAL_CAT_FALLBACKS = {
        layer_upload: 'Layer Upload',
        delete_road: 'Delete Road',
        new_road: 'New Road',
        add_road_label: 'Add Road Label',
        change_road_label: 'Change Road Label',
        new_road_geometry: 'New Road Geometry',
        new_feature_type: 'New Feature Type',
        road_attribute_edit: 'Road Attribute Edit'
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

    function findQueuedRequest(requestId) {
        for (var i = 0; i < approvalQueue.length; i++) {
            if (String(approvalQueue[i].id) === String(requestId)) {
                return approvalQueue[i];
            }
        }
        return null;
    }

    function toastApproveSuccess(data, requestId) {
        if (data && data.deleted_road_id != null) {
            return uiT('toast_road_deleted', 'Road deleted');
        }
        var req = findQueuedRequest(requestId);
        if (req && req.request_category === 'layer_upload') {
            return uiT('toast_layer_published', 'Layer published');
        }
        return uiT('toast_approved', 'Approved');
    }

    function toastRejectSuccess(data, requestId) {
        var req = findQueuedRequest(requestId);
        if (req && req.request_category === 'layer_upload') {
            return uiT('toast_layer_rejected', 'Layer rejected');
        }
        return uiT('toast_rejected', 'Rejected');
    }

    function approvalEmptyHtml() {
        return (
            '<div class="approval-empty">' +
            '<div class="approval-empty__icon">' +
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>' +
            '</svg></div>' +
            '<p class="approval-empty__title">' +
            uiT('approval_empty_title', "You're all caught up") +
            '</p>' +
            '<p class="approval-empty__text">' +
            uiT(
                'approval_empty_text',
                'No editor submissions need your review right now.'
            ) +
            '</p></div>'
        );
    }

    function categoryLabel(key, fallback) {
        const fb =
            fallback ||
            APPROVAL_CAT_FALLBACKS[key] ||
            APPROVAL_CAT_FALLBACKS.road_attribute_edit;
        return uiT('approval_cat_' + (key || 'road_attribute_edit'), fb);
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
            return uiT('time_just_now', 'Just now');
        }
        if (diffMins < 60) {
            return uiT('time_minutes_ago', '{n}m ago').replace('{n}', String(diffMins));
        }
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) {
            return uiT('time_hours_ago', '{n}h ago').replace('{n}', String(diffHours));
        }
        if (typeof window.formatRiyadhDate === 'function' && typeof window.formatRiyadhClock === 'function') {
            return window.formatRiyadhDate(isoString) + ', ' + window.formatRiyadhClock(isoString);
        }
        return '';
    }

    function requesterInitials(name) {
        const parts = String(name || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!parts.length) {
            return 'U';
        }
        if (parts.length === 1) {
            return parts[0].slice(0, 2).toUpperCase();
        }
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }

    function buildRequesterAvatarHtml(request, className) {
        const classes = String(className || 'approval-avatar').trim();
        const name = String(
            request.requester_name || uiT('unknown_user', 'Unknown')
        );
        const imageUrl = request.profile_image_url
            ? String(request.profile_image_url).trim()
            : '';
        if (imageUrl) {
            return (
                '<span class="' +
                classes +
                ' approval-avatar--photo" aria-hidden="true">' +
                '<img src="' +
                escapeHtml(imageUrl) +
                '" alt="">' +
                '</span>'
            );
        }
        return (
            '<span class="' +
            classes +
            '" aria-hidden="true">' +
            escapeHtml(requesterInitials(name)) +
            '</span>'
        );
    }

    function approvalRowTitle(request, typeMeta) {
        const named = String(request.road_name || '').trim();
        if (named) {
            return named;
        }
        if (typeMeta && typeMeta.key === 'layer_upload' && request.shapefile_name) {
            return String(request.shapefile_name).trim();
        }
        return uiT('unnamed_road', 'Unnamed Road');
    }

    function featureTypeDisplayLabel(request) {
        const raw = String(request.current_feature_label || '').trim();
        if (!raw) {
            return '';
        }
        if (typeof window.displayFeatureTypeLabel === 'function') {
            return window.displayFeatureTypeLabel(raw);
        }
        return raw;
    }

    function getRequestTypeMeta(request) {
        const categoryKey = request.request_category || 'road_attribute_edit';
        return {
            key: categoryKey,
            label: categoryLabel(categoryKey, request.request_category_label),
            categoryClass: 'approval-cat--' + categoryKey
        };
    }

    function getFilteredApprovalQueue() {
        if (approvalFilterKey === 'all') {
            return approvalQueue;
        }
        return approvalQueue.filter(function (request) {
            return (request.request_category || '') === approvalFilterKey;
        });
    }

    function syncApprovalFilterBar() {
        const bar = document.getElementById('approvalRequestsFilterBar');
        if (!bar) {
            return;
        }
        bar.querySelectorAll('[data-approval-filter]').forEach(function (btn) {
            const active =
                (btn.getAttribute('data-approval-filter') || 'all') ===
                approvalFilterKey;
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function isApprovalPanelOpen() {
        const panel = document.getElementById('approvalRequestsPanel');
        return !!(panel && panel.classList.contains('approval-panel--open'));
    }

    function setApprovalPanelOpen(open) {
        const panel = document.getElementById('approvalRequestsPanel');
        const bell = document.getElementById('approvalRequestsBell');
        if (!panel) {
            return;
        }
        panel.classList.toggle('approval-panel--open', !!open);
        if (bell) {
            bell.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        // Closing the list must not cancel an in-progress map review.
        syncApprovalUI();
    }

    function metaLineHtml(label, valueHtml, valueModifier) {
        if (!valueHtml) {
            return '';
        }
        const valueClass = valueModifier
            ? 'approval-row__meta-value ' + valueModifier
            : 'approval-row__meta-value';
        return (
            '<div class="approval-row__meta-line">' +
            '<span class="approval-row__meta-label">' +
            escapeHtml(label) +
            '</span>' +
            '<span class="' +
            valueClass +
            '">' +
            valueHtml +
            '</span></div>'
        );
    }

    function setFocusedPendingLocksMuted(muted) {
        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.setFocusedReviewActive === 'function'
        ) {
            try {
                window.PendingRoadLocks.setFocusedReviewActive(!!muted);
            } catch (eMute) {}
        }
    }

    function clearReviewBasemapHide() {
        if (typeof window.setRiyadhRoadBasemapHiddenForClosureOverlay === 'function') {
            try {
                window.setRiyadhRoadBasemapHiddenForClosureOverlay(null, false);
            } catch (eBase) {}
        }
    }

    function hideReviewedRoadOnBasemap(request) {
        if (!request || !request.geometry_changed) {
            clearReviewBasemapHide();
            return;
        }
        const rid =
            request.riyadh_road_id != null
                ? request.riyadh_road_id
                : request.road_id != null
                  ? request.road_id
                  : null;
        if (rid == null || rid === '') {
            clearReviewBasemapHide();
            return;
        }
        if (typeof window.setRiyadhRoadBasemapHiddenForClosureOverlay === 'function') {
            try {
                window.setRiyadhRoadBasemapHiddenForClosureOverlay(rid, true);
            } catch (eHide) {}
        }
        if (typeof window.hideSelectedOverlayPaint === 'function') {
            try {
                window.hideSelectedOverlayPaint();
            } catch (eSel) {}
        }
    }

    function setManagerReviewMode(active, request) {
        window.managerApprovalReviewActive = Boolean(active);
        document.body.classList.toggle('manager-review-dock-active', Boolean(active));
        setFocusedPendingLocksMuted(active);
        if (active) {
            if (typeof window.forceExitMapEditModeForReview === 'function') {
                window.forceExitMapEditModeForReview();
            }
            const editToolbar = document.getElementById('editToolbar');
            if (editToolbar) {
                editToolbar.classList.add('hidden');
            }
            if (typeof window.hideRiyadhGeometryEditToolbar === 'function') {
                window.hideRiyadhGeometryEditToolbar();
            }
            if (request) {
                hideReviewedRoadOnBasemap(request);
            }
        } else {
            clearReviewBasemapHide();
            if (typeof window.syncEditButtonReviewState === 'function') {
                window.syncEditButtonReviewState();
            }
        }
        if (typeof window.syncRoadPanelEditModeUI === 'function') {
            window.syncRoadPanelEditModeUI();
        }
        if (
            window.PendingRoadLocks &&
            typeof window.PendingRoadLocks.syncPendingBanner === 'function'
        ) {
            try {
                window.PendingRoadLocks.syncPendingBanner();
            } catch (eBanner) {}
        }
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
        const title = approvalRowTitle(request, typeMeta);
        const featureType = featureTypeDisplayLabel(request);
        const requesterName = String(
            request.requester_name || uiT('unknown_user', 'Unknown')
        );
        const requesterEmail = String(request.requester_email || '').trim();
        const roleRaw = String(request.requester_role || 'Editor');
        const requesterRole = uiT(
            'role_' + roleRaw.toLowerCase().replace(/\s+/g, '_'),
            roleRaw
        );
        const timeLabel = formatRequestTime(request.created_at);
        const shapefileName = String(request.shapefile_name || '').trim();
        const showShapefileMeta =
            typeMeta.key === 'layer_upload' &&
            shapefileName &&
            shapefileName !== title;

        const userValueHtml =
            buildRequesterAvatarHtml(request, 'approval-avatar approval-avatar--sm') +
            '<span class="approval-row__user-name">' +
            escapeHtml(requesterName) +
            '</span>';

        const editTypeValueHtml =
            '<span class="approval-row__type-dot" aria-hidden="true"></span>' +
            escapeHtml(typeMeta.label);

        const card = document.createElement('article');
        card.className = 'approval-row ' + typeMeta.categoryClass;
        card.setAttribute('data-request-id', request.id);
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', typeMeta.label + ': ' + title);
        card.innerHTML =
            '<div class="approval-row__body">' +
            '<div class="approval-row__headline">' +
            '<span class="approval-row__title">' +
            escapeHtml(title) +
            '</span>' +
            '<time class="approval-row__time" datetime="' +
            escapeHtml(String(request.created_at || '')) +
            '">' +
            escapeHtml(timeLabel) +
            '</time></div>' +
            '<div class="approval-row__meta">' +
            metaLineHtml(
                uiT('approval_meta_user', 'User'),
                userValueHtml,
                'approval-row__meta-value--user'
            ) +
            metaLineHtml(
                uiT('approval_meta_email', 'Email'),
                requesterEmail ? escapeHtml(requesterEmail) : ''
            ) +
            metaLineHtml(
                uiT('approval_meta_role', 'Role'),
                escapeHtml(requesterRole)
            ) +
            metaLineHtml(
                uiT('approval_meta_edit_type', 'Edit type'),
                editTypeValueHtml,
                'approval-row__meta-value--type'
            ) +
            metaLineHtml(
                uiT('feature_type', 'Feature type'),
                featureType ? escapeHtml(featureType) : ''
            ) +
            metaLineHtml(
                uiT('approval_meta_shapefile', 'Shapefile'),
                showShapefileMeta ? escapeHtml(shapefileName) : ''
            ) +
            '</div></div>' +
            '<span class="approval-row__chevron" aria-hidden="true">' +
            ROW_CHEVRON_SVG +
            '</span>';

        function openRow() {
            openApprovalRequest(request.id);
        }
        card.addEventListener('click', openRow);
        card.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openRow();
            }
        });

        return card;
    }

    function approvalBellAriaLabel(count) {
        if (count === 0) {
            return uiT('approval_bell_zero', '0 approval requests');
        }
        if (count === 1) {
            return uiT('approval_bell_one', '1 approval request');
        }
        return uiT('approval_bell_many', '{n} approval requests').replace(
            '{n}',
            String(count)
        );
    }

    function approvalSummaryText(count, shown) {
        if (count === 0) {
            return uiT('approval_summary_none', 'Nothing pending review');
        }
        if (approvalFilterKey !== 'all' && shown !== count) {
            return uiT('approval_summary_filtered', 'Showing {shown} of {count}')
                .replace('{shown}', String(shown))
                .replace('{count}', String(count));
        }
        if (count === 1) {
            return uiT(
                'approval_summary_one',
                '1 submission awaiting review'
            );
        }
        return uiT(
            'approval_summary_many',
            '{n} submissions awaiting review'
        ).replace('{n}', String(count));
    }

    function syncApprovalUI() {
        const count = approvalQueue.length;
        const shown = getFilteredApprovalQueue().length;
        const panelOpen = isApprovalPanelOpen();

        const countPill = document.getElementById('approvalRequestsPanelCount');
        if (countPill) {
            countPill.textContent = count > 0 ? String(count) : '';
            countPill.setAttribute('data-count', String(count));
        }

        const badge = document.getElementById('approvalRequestsBellBadge');
        if (badge) {
            badge.textContent = String(count);
            badge.hidden = count === 0;
        }

        const bell = document.getElementById('approvalRequestsBell');
        if (bell) {
            bell.setAttribute('aria-label', approvalBellAriaLabel(count));
        }

        const summary = document.getElementById('approvalRequestsPanelSummary');
        if (summary) {
            summary.textContent = approvalSummaryText(count, shown);
        }

        const filterBar = document.getElementById('approvalRequestsFilterBar');
        if (filterBar) {
            const showFilters = count > 0 && panelOpen;
            filterBar.classList.toggle(
                'approval-panel__filters--visible',
                showFilters
            );
            if (showFilters) {
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
            requestsList.innerHTML =
                '<p class="approval-empty-filter">' +
                escapeHtml(
                    uiT('approval_empty_filter', 'No requests match this filter.')
                ) +
                '</p>';
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
        const layerIds = [
            'request-line-layer-' + featureId,
            'request-line-ring-' + featureId,
            'request-line-outline-' + featureId,
            'request-line-before-layer-' + featureId,
            'request-line-before-underlay-' + featureId,
        ];
        const sourceIds = [
            'request-line-source-' + featureId,
            'request-line-before-source-' + featureId,
        ];
        layerIds.forEach(function (lid) {
            try {
                if (map.getLayer(lid)) {
                    map.removeLayer(lid);
                }
            } catch (e) {}
        });
        sourceIds.forEach(function (sid) {
            try {
                if (map.getSource(sid)) {
                    map.removeSource(sid);
                }
            } catch (e2) {}
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
        removeApproveRejectButtons({ keepReviewMode: true });
        setApprovalPanelOpen(false);
        setManagerReviewMode(true, request);
        
        const normalizedGeometry = normalizeRequestGeometry(request.geometry);
        if (!normalizedGeometry || !normalizedGeometry.coordinates || normalizedGeometry.coordinates.length < 2) {
            showToast(
                uiT(
                    'toast_cant_show_on_map',
                    "Can't show on the map. Details are still available."
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
                setManagerReviewMode(true, requestForMap);
            }, 1100);
        });
    }

    // Open the side panel for read-only review (no draw/edit toolbar).
    function ensureSidePanelForReview(callback) {
        const sidePanel = document.getElementById('editSidePanel');

        setManagerReviewMode(true, null);

        if (!sidePanel) {
            if (callback) {
                setTimeout(callback, 100);
            }
            return;
        }

        const isCurrentlyActive = !sidePanel.classList.contains('msp-is-closed');
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
            sidePanel.classList.remove('msp-is-closed');
        }
        setTimeout(function() {
            setManagerReviewMode(true);
            if (callback) {
                callback();
            }
        }, 400);
    }

    function upsertReviewLineLayer(sourceId, layerId, geometry, paint, layout) {
        if (typeof map === 'undefined' || !map || !geometry) {
            return;
        }
        try {
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'Feature', geometry: geometry }
            });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: layout || {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                paint: paint
            });
        } catch (error) {}
    }

    function bringReviewCompareLayersToFront(featureId) {
        if (typeof map === 'undefined' || !map || typeof map.moveLayer !== 'function') {
            return;
        }
        [
            'request-line-before-underlay-' + featureId,
            'request-line-before-layer-' + featureId,
            'request-line-layer-' + featureId,
            'request-line-ring-' + featureId,
            'request-line-outline-' + featureId,
        ].forEach(function (lid) {
            if (!map.getLayer(lid)) {
                return;
            }
            try {
                map.moveLayer(lid);
            } catch (eMove) {}
        });
    }

    // Ghosted original path - pale underlay + dashed zinc, always behind proposed.
    function renderBeforeRequestLine(featureId, geometry) {
        const sourceId = 'request-line-before-source-' + featureId;
        const underlayId = 'request-line-before-underlay-' + featureId;
        const layerId = 'request-line-before-layer-' + featureId;
        if (typeof map === 'undefined' || !map || !geometry) {
            return;
        }
        try {
            [underlayId, layerId].forEach(function (lid) {
                if (map.getLayer(lid)) {
                    map.removeLayer(lid);
                }
            });
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'Feature', geometry: geometry }
            });
            map.addLayer({
                id: underlayId,
                type: 'line',
                source: sourceId,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 8,
                    'line-opacity': 0.92
                }
            });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#52525b',
                    'line-width': 3,
                    'line-opacity': 1,
                    'line-dasharray': [2.25, 1.75]
                }
            });
        } catch (error) {}
    }

    // Proposed path - solid brand navy, drawn above original (no third overlay).
    function renderProposedRequestLine(featureId, geometry) {
        upsertReviewLineLayer(
            'request-line-source-' + featureId,
            'request-line-layer-' + featureId,
            geometry,
            {
                'line-color': '#0f2d53',
                'line-width': 5.5,
                'line-opacity': 1
            }
        );
    }

    function renderRequestCompareOnMap(featureId, request) {
        const normAfter = normalizeRequestGeometry(request.geometry);
        if (!normAfter) {
            return;
        }

        const normBefore =
            request.original_geometry && request.geometry_changed
                ? normalizeRequestGeometry(request.original_geometry)
                : null;

        // Geometry reviews: only Original (ghost) + Proposed (solid).
        // Pending-lock orange + live basemap road are muted while the dock is open.
        if (normBefore && request.geometry_changed) {
            hideReviewedRoadOnBasemap(request);
            setFocusedPendingLocksMuted(true);
            renderBeforeRequestLine(featureId, normBefore);
            renderProposedRequestLine(featureId, normAfter);
            bringReviewCompareLayersToFront(featureId);
            return;
        }

        setFocusedPendingLocksMuted(true);
        renderRequestLineAsMapLibreLayer(
            featureId,
            Object.assign({}, request, { geometry: normAfter })
        );
        bringReviewCompareLayersToFront(featureId);
    }

    // Draw the request line on the map (Original + Proposed for reshapes; styled line otherwise).
    function drawRequestLineOnMap(request) {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        const featureId = 'request-' + request.id;
        renderRequestCompareOnMap(featureId, request);
        
        // Keep panel / symbology in sync with the reviewed feature type.
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
            const label = String(request.current_feature_label || '').trim();
            window.lineDrawingHandler.updateCurrentFeatureLabel(label || 'Line');
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
        const featureLabel = String(request.current_feature_label || '').trim() || 'Line';
        const featureStyle =
            typeof getStyle === 'function' ? getStyle(featureLabel) : null;
        // Always draw something during review - never silently skip if symbology is missing.
        const style =
            (isRoadClosed && closureStyle) ||
            featureStyle || {
                lineColor: '#0f2d53',
                lineWidth: 5,
                lineOpacity: 1,
                lineDasharray: [1, 0],
            };

        const lineDasharray =
            style.lineDasharray && Array.isArray(style.lineDasharray)
                ? style.lineDasharray
                : [1, 0];

        var mls = window.MapLineSelection;
        if (!mls) {
            return;
        }
        var paintLabel = isRoadClosed ? closureLabel : featureLabel;
        var corePaint = mls.buildEditingCorePaint(style, lineDasharray, paintLabel);
        var pair = isRoadClosed
            ? null
            : mls.maplibreSelectionCasingPaintPair(style.lineWidth || 5, lineDasharray);

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

    function buildReviewLineData(request) {
        const fields =
            request.fields_data && typeof request.fields_data === 'object'
                ? Object.assign({}, request.fields_data)
                : {};
        const roadName = String(request.road_name || fields.name || '').trim();
        if (roadName && !String(fields.name || '').trim()) {
            fields.name = roadName;
        }
        return {
            road_closure: request.road_closure,
            fields_data: fields,
            current_feature_label: request.current_feature_label || '',
            is_riyadh_road: !!request.is_riyadh_road,
            riyadh_road_id: request.riyadh_road_id,
        };
    }

    // Open the road panel for read-only review and fill feature / label / closure.
    function populateSidepanelWithRequestData(request) {
        const sidePanel = document.getElementById('editSidePanel');
        setManagerReviewMode(true, request);
        if (!sidePanel) {
            return;
        }

        if (sidePanel.classList.contains('msp-is-closed')) {
            if (typeof window.initMapSidePanelChrome === 'function') {
                window.initMapSidePanelChrome();
            }
            if (typeof window.applyMapSidePanelOpen === 'function') {
                window.applyMapSidePanelOpen(true);
            } else {
                sidePanel.classList.remove('msp-is-closed');
            }
        }

        const featureLabel = String(request.current_feature_label || '').trim();
        if (
            window.lineDrawingHandler &&
            typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function'
        ) {
            window.lineDrawingHandler.updateCurrentFeatureLabel(
                featureLabel || 'Line'
            );
        }

        const reviewLineData = buildReviewLineData(request);

        setTimeout(function () {
            if (
                window.lineDrawingHandler &&
                typeof window.lineDrawingHandler.showEditFeatureScreen === 'function'
            ) {
                window.lineDrawingHandler.showEditFeatureScreen({
                    hideBackButton: true,
                    requestGeometry: request.geometry,
                    lineData: reviewLineData,
                });
            }
            setTimeout(function () {
                setManagerReviewMode(true);
                populateFieldsData(reviewLineData.fields_data);
                if (typeof window.syncRoadPanelEditModeUI === 'function') {
                    window.syncRoadPanelEditModeUI();
                }
            }, 50);
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

    // Floating review dock: edit type + requester meta, above Lon/Lat/Zoom.
    function createApproveRejectButtons(request) {
        removeApproveRejectButtons();
        const showLegend = Boolean(
            request.geometry_changed && request.original_geometry
        );
        setManagerReviewMode(true, request);

        const typeMeta = getRequestTypeMeta(request);
        const requesterName = String(
            request.requester_name || uiT('unknown_user', 'Unknown')
        );
        const requesterEmail = String(request.requester_email || '').trim();
        const timeLabel = formatRequestTime(request.created_at);

        const dock = document.createElement('div');
        dock.id = 'approveRejectButtonsContainer';
        dock.className = 'approval-review-dock';
        dock.setAttribute('role', 'region');
        dock.setAttribute(
            'aria-label',
            uiT('approval_review_dock_aria', 'Review decision')
        );

        const card = document.createElement('div');
        card.className = 'approval-review-dock__card';

        // Edit type + requester only - road name lives in the side panel.
        const copy = document.createElement('div');
        copy.className = 'approval-review-dock__copy';
        copy.innerHTML =
            '<p class="approval-review-dock__eyebrow">' +
            escapeHtml(uiT('approval_review_eyebrow', 'Review')) +
            '</p>' +
            '<p class="approval-review-dock__title">' +
            escapeHtml(typeMeta.label) +
            '</p>' +
            '<div class="approval-review-dock__requester">' +
            buildRequesterAvatarHtml(request, 'approval-avatar') +
            '<div class="approval-review-dock__requester-meta">' +
            '<span class="approval-review-dock__requester-name">' +
            escapeHtml(requesterName) +
            '</span>' +
            (requesterEmail
                ? '<span class="approval-review-dock__requester-email">' +
                  escapeHtml(requesterEmail) +
                  '</span>'
                : '') +
            (timeLabel
                ? '<time class="approval-review-dock__requester-time" datetime="' +
                  escapeHtml(String(request.created_at || '')) +
                  '">' +
                  escapeHtml(timeLabel) +
                  '</time>'
                : '') +
            '</div></div>';
        card.appendChild(copy);

        const actions = document.createElement('div');
        actions.className = 'approval-review-dock__actions';

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.id = 'rejectRequestBtn';
        rejectBtn.className = 'approval-review-dock__btn approval-review-dock__btn--reject';
        rejectBtn.innerHTML =
            '<svg class="approval-review-dock__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>' +
            '</svg><span>' +
            escapeHtml(uiT('reject', 'Reject')) +
            '</span>';
        rejectBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openRejectReasonDialog(function (payload) {
                if (payload) {
                    rejectRequest(request.id, payload);
                }
            });
        });

        const approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.id = 'approveRequestBtn';
        approveBtn.className = 'approval-review-dock__btn approval-review-dock__btn--approve';
        approveBtn.innerHTML =
            '<svg class="approval-review-dock__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>' +
            '</svg><span>' +
            escapeHtml(uiT('approve', 'Approve')) +
            '</span>';
        approveBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            approveRequest(request.id);
        });

        actions.appendChild(rejectBtn);
        actions.appendChild(approveBtn);
        card.appendChild(actions);

        if (showLegend) {
            const legend = document.createElement('div');
            legend.className = 'approval-review-dock__legend';
            legend.innerHTML =
                '<span><i class="approval-review-dock__swatch approval-review-dock__swatch--original" aria-hidden="true"></i>' +
                escapeHtml(uiT('approval_legend_original', 'Original')) +
                '</span>' +
                '<span><i class="approval-review-dock__swatch approval-review-dock__swatch--proposed" aria-hidden="true"></i>' +
                escapeHtml(uiT('approval_legend_proposed', 'Proposed')) +
                '</span>';
            card.appendChild(legend);
        }

        dock.appendChild(card);
        document.body.appendChild(dock);
        try {
            window.dispatchEvent(new CustomEvent('map:selectionChanged'));
        } catch (eSel) {}
    }

    function removeApproveRejectButtons(options) {
        const opts = options || {};
        const container = document.getElementById('approveRejectButtonsContainer');
        if (container) {
            container.remove();
        }
        if (!opts.keepReviewMode) {
            setManagerReviewMode(false);
        }
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
                showToast(toastApproveSuccess(data, requestId), 'success');
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

    function closeRejectReasonDialog() {
        const existing = document.getElementById('approvalRejectDialog');
        if (existing) {
            existing.remove();
        }
        document.body.classList.remove('approval-reject-dialog-open');
    }

    function openRejectReasonDialog(onDone) {
        closeRejectReasonDialog();
        const overlay = document.createElement('div');
        overlay.id = 'approvalRejectDialog';
        overlay.className = 'approval-reject-dialog';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute(
            'aria-label',
            uiT('reject_request_title', 'Reject request')
        );
        overlay.innerHTML =
            '<div class="approval-reject-dialog__card">' +
            '<h3 class="approval-reject-dialog__title">' +
            uiT('reject_request_title', 'Reject request') +
            '</h3>' +
            '<p class="approval-reject-dialog__hint">' +
            uiT(
                'reject_request_hint',
                'Add a short reason for the editor, or choose No reason.'
            ) +
            '</p>' +
            '<label class="approval-reject-dialog__label" for="approvalRejectReason">' +
            uiT('reject_reason_label', 'Reason') +
            '</label>' +
            '<textarea id="approvalRejectReason" class="approval-reject-dialog__textarea" rows="3" maxlength="500"></textarea>' +
            '<label class="approval-reject-dialog__check">' +
            '<input type="checkbox" id="approvalRejectNoReason" />' +
            '<span>' +
            uiT('reject_no_reason', 'No reason') +
            '</span>' +
            '</label>' +
            '<div class="approval-reject-dialog__actions">' +
            '<button type="button" class="approval-reject-dialog__btn approval-reject-dialog__btn--cancel" data-reject-cancel>' +
            uiT('cancel', 'Cancel') +
            '</button>' +
            '<button type="button" class="approval-reject-dialog__btn approval-reject-dialog__btn--confirm" data-reject-confirm>' +
            uiT('reject', 'Reject') +
            '</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(overlay);
        document.body.classList.add('approval-reject-dialog-open');

        const textarea = overlay.querySelector('#approvalRejectReason');
        const noReason = overlay.querySelector('#approvalRejectNoReason');
        const confirmBtn = overlay.querySelector('[data-reject-confirm]');
        const cancelBtn = overlay.querySelector('[data-reject-cancel]');

        function syncNoReason() {
            const off = !!noReason.checked;
            textarea.disabled = off;
            if (off) {
                textarea.value = '';
            }
        }
        noReason.addEventListener('change', syncNoReason);

        function finish(payload) {
            closeRejectReasonDialog();
            if (typeof onDone === 'function') {
                onDone(payload);
            }
        }

        cancelBtn.addEventListener('click', function () {
            finish(null);
        });
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) {
                finish(null);
            }
        });
        confirmBtn.addEventListener('click', function () {
            if (noReason.checked) {
                finish({ no_reason: true, reason: '' });
                return;
            }
            const reason = (textarea.value || '').trim();
            if (!reason) {
                showToast(
                    uiT(
                        'reject_reason_required',
                        'Add a rejection reason, or choose No reason.'
                    ),
                    'warning'
                );
                textarea.focus();
                return;
            }
            finish({ no_reason: false, reason: reason });
        });

        requestAnimationFrame(function () {
            textarea.focus();
        });
    }

    function rejectRequest(requestId, payload) {
        payload = payload || {};
        fetch('/mapping/api/request/' + requestId + '/reject/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken'),
                Accept: 'application/json',
            },
            body: JSON.stringify({
                reason: payload.reason || '',
                no_reason: !!payload.no_reason,
            }),
        })
        .then(function(response) {
            return response.json().then(function (data) {
                return { ok: response.ok, data: data };
            });
        })
        .then(function(result) {
            const data = result.data || {};
            if (result.ok && data.success) {
                showToast(toastRejectSuccess(data, requestId), 'success');
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

    window.populateFieldsData = populateFieldsData;

})();

