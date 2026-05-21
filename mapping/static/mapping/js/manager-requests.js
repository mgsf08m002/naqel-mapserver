// Manager approval queue: widget UI, API sync, map review, and approve/reject flow.
(function() {
    'use strict';

    let approvalQueue = [];

    function approvalEmptyHtml() {
        return `
            <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-50 ring-1 ring-zinc-200/80">
                    <svg class="h-7 w-7 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                    </svg>
                </div>
                <p class="text-sm font-semibold text-zinc-800">All clear</p>
                <p class="mt-1 max-w-[14rem] text-xs leading-relaxed text-zinc-500">No submissions are waiting for your approval.</p>
            </div>
        `;
    }

    function requesterDisplayLine(name, role) {
        const safeName = (name || 'Unknown').trim();
        const safeRole = (role || '').trim();
        if (!safeRole || safeRole.toLowerCase() === safeName.toLowerCase()) {
            return safeName;
        }
        return safeName + ' · ' + safeRole;
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
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
            ', ' +
            date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function getRequestTypeMeta(request) {
        const isDelete = (request.edit_type || '').toUpperCase() === 'DELETE';
        const isLayerUpload = Boolean(request.is_layer_upload);
        if (isLayerUpload) {
            return {
                label: 'Layer upload',
                chipClass: 'bg-sky-50 text-sky-700 ring-sky-600/15',
                actionLabel: 'Review on map'
            };
        }
        if (isDelete) {
            return {
                label: 'Deletion',
                chipClass: 'bg-rose-50 text-rose-700 ring-rose-600/15',
                actionLabel: 'Review deletion'
            };
        }
        const raw = (request.edit_type || 'Line edit').replace(/_/g, ' ').toLowerCase();
        return {
            label: raw.charAt(0).toUpperCase() + raw.slice(1),
            chipClass: 'bg-zinc-100 text-zinc-700 ring-zinc-500/10',
            actionLabel: 'Review edit'
        };
    }

    function setApprovalPanelOpen(open) {
        const panel = document.getElementById('approvalRequestsPanel');
        const toggle = document.getElementById('approvalRequestsToggle');
        const chevron = document.getElementById('approvalRequestsChevron');
        if (!panel) {
            return;
        }
        if (open) {
            panel.classList.remove('hidden');
            panel.classList.add('flex');
            if (toggle) {
                toggle.setAttribute('aria-expanded', 'true');
            }
            if (chevron) {
                chevron.classList.add('rotate-180');
            }
            syncApprovalWidget();
        } else {
            panel.classList.add('hidden');
            panel.classList.remove('flex');
            if (toggle) {
                toggle.setAttribute('aria-expanded', 'false');
            }
            if (chevron) {
                chevron.classList.remove('rotate-180');
            }
            removeApproveRejectButtons();
            syncApprovalWidget();
        }
    }

    function isApprovalPanelOpen() {
        const panel = document.getElementById('approvalRequestsPanel');
        return panel && !panel.classList.contains('hidden');
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

    const APPROVAL_WIDGET_POSITION_KEY = 'naqel.approvalRequests.position';

    function clampApprovalWidgetPosition(left, top, width, height) {
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);
        return {
            left: Math.min(Math.max(margin, left), maxLeft),
            top: Math.min(Math.max(margin, top), maxTop)
        };
    }

    function applyApprovalWidgetPosition(root, left, top) {
        const rect = root.getBoundingClientRect();
        const clamped = clampApprovalWidgetPosition(left, top, rect.width, rect.height);
        root.style.left = clamped.left + 'px';
        root.style.top = clamped.top + 'px';
        root.style.right = 'auto';
        return clamped;
    }

    function restoreApprovalWidgetPosition(root) {
        try {
            const raw = localStorage.getItem(APPROVAL_WIDGET_POSITION_KEY);
            if (!raw) {
                return;
            }
            const saved = JSON.parse(raw);
            if (typeof saved.left === 'number' && typeof saved.top === 'number') {
                applyApprovalWidgetPosition(root, saved.left, saved.top);
            }
        } catch (err) {
            /* ignore invalid saved position */
        }
    }

    function saveApprovalWidgetPosition(root) {
        const rect = root.getBoundingClientRect();
        localStorage.setItem(
            APPROVAL_WIDGET_POSITION_KEY,
            JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })
        );
    }

    function attachApprovalWidgetDrag(root, handle) {
        let dragging = false;
        let didDrag = false;
        let pointerId = null;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener('pointerdown', function(event) {
            if (event.button !== 0) {
                return;
            }
            dragging = true;
            didDrag = false;
            pointerId = event.pointerId;
            const rect = root.getBoundingClientRect();
            applyApprovalWidgetPosition(root, rect.left, rect.top);
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            handle.setPointerCapture(pointerId);
            handle.classList.add('cursor-grabbing');
            root.classList.add('select-none');
            event.preventDefault();
        });

        handle.addEventListener('pointermove', function(event) {
            if (!dragging || event.pointerId !== pointerId) {
                return;
            }
            didDrag = true;
            applyApprovalWidgetPosition(
                root,
                event.clientX - offsetX,
                event.clientY - offsetY
            );
        });

        function endDrag(event) {
            if (!dragging || (event && event.pointerId !== pointerId)) {
                return;
            }
            dragging = false;
            handle.classList.remove('cursor-grabbing');
            root.classList.remove('select-none');
            if (handle.hasPointerCapture(pointerId)) {
                handle.releasePointerCapture(pointerId);
            }
            pointerId = null;
            if (didDrag) {
                saveApprovalWidgetPosition(root);
            }
        }

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);

        return function consumeDragClick() {
            const consumed = didDrag;
            didDrag = false;
            return consumed;
        };
    }

    function buildApprovalWidget() {
        const root = document.createElement('div');
        root.id = 'approvalRequestsRoot';
        root.className = 'fixed top-[4.5rem] right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)]';

        const widget = document.createElement('div');
        widget.className =
            'flex flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-xl shadow-zinc-900/[0.07]';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.id = 'approvalRequestsToggle';
        toggleBtn.className =
            'group flex w-full cursor-grab items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 focus-visible:ring-inset active:cursor-grabbing';
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.setAttribute('aria-controls', 'approvalRequestsPanel');
        toggleBtn.setAttribute('aria-label', 'Approval requests. Drag to move. Click to expand.');
        toggleBtn.innerHTML = `
            <span id="approvalRequestsCountDisplay" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-lg font-semibold tabular-nums text-zinc-500 ring-1 ring-inset ring-zinc-200/80" aria-hidden="true">0</span>
            <span class="min-w-0 flex-1">
                <span class="block text-[15px] font-semibold tracking-tight text-zinc-900">Approval Requests</span>
                <span id="approvalRequestsSummary" class="block text-xs text-zinc-500">Open to review submissions</span>
            </span>
            <svg id="approvalRequestsChevron" class="h-5 w-5 shrink-0 text-zinc-400 transition-transform duration-200 group-hover:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
        `;
        const consumeDragClick = attachApprovalWidgetDrag(root, toggleBtn);
        toggleBtn.addEventListener('click', function(event) {
            if (consumeDragClick()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const willOpen = !isApprovalPanelOpen();
            setApprovalPanelOpen(willOpen);
            if (willOpen) {
                refreshApprovalQueue();
            }
        });
        widget.appendChild(toggleBtn);

        const panel = document.createElement('div');
        panel.id = 'approvalRequestsPanel';
        panel.className = 'hidden flex-col border-t border-zinc-100/90 max-h-[min(36rem,calc(100vh-9rem))]';

        const listHeader = document.createElement('div');
        listHeader.id = 'approvalRequestsListHeader';
        listHeader.className =
            'hidden shrink-0 items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2';
        listHeader.innerHTML =
            '<span id="approvalRequestsCount" class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500"></span>' +
            '<span class="text-[11px] text-zinc-400">Newest first</span>';
        panel.appendChild(listHeader);

        const requestsList = document.createElement('div');
        requestsList.id = 'approvalRequestsList';
        requestsList.className = 'flex-1 divide-y divide-zinc-100 overflow-y-auto overscroll-contain';
        panel.appendChild(requestsList);

        widget.appendChild(panel);
        root.appendChild(widget);
        document.body.appendChild(root);
        restoreApprovalWidgetPosition(root);

        window.addEventListener('resize', function() {
            const rect = root.getBoundingClientRect();
            applyApprovalWidgetPosition(root, rect.left, rect.top);
            saveApprovalWidgetPosition(root);
        });
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function buildApprovalRow(request) {
        const typeMeta = getRequestTypeMeta(request);
        const isLayerUpload = Boolean(request.is_layer_upload);
        const displayFeature =
            escapeHtml(String(request.current_feature_label || 'Unnamed feature'));
        const requesterLine = escapeHtml(
            requesterDisplayLine(request.requester_name, request.requester_role)
        );
        const timeLabel = escapeHtml(formatRequestTime(request.created_at));
        const layerName = request.layer_name ? escapeHtml(String(request.layer_name)) : '';

        let contextLine = requesterLine;
        if (isLayerUpload && layerName) {
            contextLine = layerName + '<span class="text-zinc-300"> · </span>' + requesterLine;
        }

        const geometryChip = request.geometry_changed
            ? '<span class="inline-flex shrink-0 items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200/80">Shape changed</span>'
            : '';

        const card = document.createElement('article');
        card.className =
            'group relative px-4 py-3.5 transition-colors hover:bg-zinc-50/90 focus-within:bg-zinc-50/90';
        card.setAttribute('data-request-id', request.id);

        const avatarHtml = request.profile_image_url
            ? '<img src="' +
              escapeHtml(request.profile_image_url) +
              '" alt="" class="h-full w-full rounded-full object-cover">'
            : '<span class="text-[10px] font-semibold text-zinc-600">' +
              escapeHtml((request.requester_name || '?').charAt(0).toUpperCase()) +
              '</span>';

        card.innerHTML =
            '<div class="mb-2 flex items-center justify-between gap-2">' +
            '<span class="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ' +
            typeMeta.chipClass +
            '">' +
            escapeHtml(typeMeta.label) +
            '</span>' +
            '<time class="shrink-0 text-[11px] tabular-nums text-zinc-400" datetime="' +
            escapeHtml(String(request.created_at || '')) +
            '">' +
            timeLabel +
            '</time>' +
            '</div>' +
            '<div class="mb-1.5 flex items-start gap-2">' +
            '<h3 class="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">' +
            displayFeature +
            '</h3>' +
            geometryChip +
            '</div>' +
            '<p class="mb-3 truncate text-xs text-zinc-500">' +
            contextLine +
            '</p>' +
            '<div class="flex items-center justify-between gap-3">' +
            '<div class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/80">' +
            avatarHtml +
            '</div>' +
            '<span class="approval-review-btn inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-900 ring-1 ring-zinc-200/90 transition-all group-hover:bg-zinc-900 group-hover:text-white group-hover:ring-zinc-900">' +
            escapeHtml(typeMeta.actionLabel) +
            '<svg class="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>' +
            '</span>' +
            '</div>';

        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.className += ' cursor-pointer';
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

    function syncApprovalWidget() {
        const count = approvalQueue.length;
        const summary = document.getElementById('approvalRequestsSummary');
        const listHeader = document.getElementById('approvalRequestsListHeader');
        const countEl = document.getElementById('approvalRequestsCount');
        const countDisplay = document.getElementById('approvalRequestsCountDisplay');

        if (countDisplay) {
            countDisplay.textContent = String(count);
            countDisplay.classList.toggle('text-zinc-500', count === 0);
            countDisplay.classList.toggle('text-zinc-900', count > 0);
        }

        if (summary) {
            if (count === 0) {
                summary.textContent = 'Open to review submissions';
            } else if (count === 1) {
                summary.textContent = '1 submission needs review';
            } else {
                summary.textContent = count + ' submissions need review';
            }
        }
        if (listHeader && countEl) {
            if (count > 0 && isApprovalPanelOpen()) {
                listHeader.classList.remove('hidden');
                listHeader.classList.add('flex');
                countEl.textContent =
                    count === 1 ? '1 pending' : count + ' pending';
            } else {
                listHeader.classList.add('hidden');
                listHeader.classList.remove('flex');
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

        if (approvalQueue.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.innerHTML = approvalEmptyHtml();
            requestsList.appendChild(emptyState);
            syncApprovalWidget();
            return;
        }

        approvalQueue.forEach(function(request) {
            requestsList.appendChild(buildApprovalRow(request));
        });
        syncApprovalWidget();
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
            } else if (data) {
                const message = data.message || 'Unknown error loading request.';
                alert('Error loading request: ' + message);
            } else {
                alert('Error loading request: Empty response from server.');
            }
        })
        .catch(function(error) {
            const message = (error && error.message) ? error.message : 'Please try again.';
            alert('Error loading request details: ' + message);
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
        if (typeof map === 'undefined' || !map) return;
        
        if (window.viewingRequestIds && window.viewingRequestIds.length > 0) {
            window.viewingRequestIds.forEach(function(featureId) {
                removeOneRequestCompareSet(featureId);
            });
            
            if (window.requestMarkers) {
                window.viewingRequestIds.forEach(function(featureId) {
                    if (window.requestMarkers[featureId]) {
                        window.requestMarkers[featureId].forEach(function(marker) {
                            marker.remove();
                        });
                        delete window.requestMarkers[featureId];
                    }
                });
            }
            
            window.viewingRequestIds = [];
        }
    }

    // Zoom the map to the request geometry, draw it, and open the details UI.
    function showEditRequestOnMap(request) {
        if (typeof map === 'undefined' || !map) {
            alert('Map not initialized');
            return;
        }

        cleanupRequestLines();
        removeApproveRejectButtons();
        hideEditToolbarsForReview();

        setApprovalPanelOpen(false);
        
        const normalizedGeometry = normalizeRequestGeometry(request.geometry);
        if (!normalizedGeometry || !normalizedGeometry.coordinates || normalizedGeometry.coordinates.length < 2) {
            if (window.notify && window.notify.warning) {
                window.notify.warning('This edit request has invalid geometry and cannot be shown on the map, but its details can still be reviewed.');
            }

            ensureSidePanelForReview(function() {
                populateSidepanelWithRequestData(request);
                showRequestDetailsSidepanel(request);
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
            const coordinates = normalizedGeometry.coordinates;
            minLng = coordinates[0][0];
            minLat = coordinates[0][1];
            maxLng = coordinates[0][0];
            maxLat = coordinates[0][1];
            coordinates.forEach(function(coord) {
                minLng = Math.min(minLng, coord[0]);
                minLat = Math.min(minLat, coord[1]);
                maxLng = Math.max(maxLng, coord[0]);
                maxLat = Math.max(maxLat, coord[1]);
            });
        }

        const bounds = [[minLng, minLat], [maxLng, maxLat]];

        map.fitBounds(bounds, {
            padding: 100,
            duration: 1000
        });
        ensureSidePanelForReview(function() {
            setTimeout(function() {
                drawRequestLineOnMap(requestForMap);
                populateSidepanelWithRequestData(requestForMap);
                showRequestDetailsSidepanel(request);
                hideEditToolbarsForReview();
            }, 1100);
        });
    }

    // Open the side panel for read-only review (no draw/edit toolbar).
    function ensureSidePanelForReview(callback) {
        const sidePanel = document.getElementById('editSidePanel');
        const mapContainer = document.getElementById('mapContainer');

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
            if (mapContainer) {
                mapContainer.style.marginLeft = '320px';
                mapContainer.style.width = 'calc(100% - 320px)';
            }
        }
        if (typeof map !== 'undefined' && map && map.resize) {
            setTimeout(function() {
                map.resize();
            }, 100);
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
            window.lineDrawingHandler.updateCurrentFeatureLabel(request.current_feature_label || 'Line');
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
        const getStyle = window.getVisualizationStyle;
        const closureStyle = typeof getStyle === "function" ? getStyle("Road Closure") : null;
        const featureStyle = typeof getStyle === "function" ? getStyle(request.current_feature_label || "Line") : null;
        const style = (isRoadClosed && closureStyle) ? closureStyle : featureStyle;
        if (!style) {
            return;
        }

        const lineDasharray = (style.lineDasharray && Array.isArray(style.lineDasharray)) ? style.lineDasharray : [1, 0];

        if (!window.MapLineSelection) {
            return;
        }
        var mls = window.MapLineSelection;
        var pair = mls.maplibreSelectionCasingPaintPair(
            style.lineWidth,
            lineDasharray,
            isRoadClosed ? { dashOnlyOnCore: true } : undefined
        );

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
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': style.lineColor,
                    'line-width': style.lineWidth,
                    'line-opacity': 1,
                    'line-dasharray': lineDasharray
                }
            });
        } catch (error) {}
    }

    // Fill the tags section of the side panel from request.tags_data.
    function populateTagsData(tagsData) {
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        const tagsLabel = document.getElementById('tags-label-span');

        if (!tagsRowsContainer || !tagsLabel) return;

        tagsRowsContainer.innerHTML = '';
        if (!Array.isArray(tagsData) || tagsData.length === 0) {
            tagsLabel.textContent = 'Tags (0)';
            return;
        }

        tagsData.forEach(function(tag) {
            if (tag.key || tag.value) {
                createTagRow(tagsRowsContainer, tagsLabel, tag.key || '', tag.value || '');
            }
        });
    }

    // Create a single editable tag row (key/value) in the tags section.
    function createTagRow(container, labelElement, key, value) {
        const tagRow = document.createElement('div');
        tagRow.className = 'flex items-center gap-2';
        const tagId = 'tag-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        tagRow.id = tagId;

        const leftDropdown = document.createElement('div');
        leftDropdown.className = 'relative flex-1 min-w-0';

        const leftInput = document.createElement('input');
        leftInput.type = 'text';
        leftInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all cursor-pointer';
        leftInput.placeholder = 'Add new tag';
        leftInput.readOnly = true;
        leftInput.value = key;

        const leftChevron = document.createElement('div');
        leftChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
        leftChevron.innerHTML = '<svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        const leftMenu = document.createElement('div');
        leftMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 hidden max-h-60 overflow-y-auto';

        const tagOptions = ['building', 'highway', 'source', 'name', 'surface', 'natural', 'addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'];
        tagOptions.forEach(function(option) {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-3 py-2 text-xs text-zinc-900 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100 last:border-b-0';
            menuItem.textContent = option;
            menuItem.addEventListener('click', function(e) {
                e.stopPropagation();
                leftInput.value = option;
                leftMenu.classList.add('hidden');
                updateTagsCount(labelElement);
            });
            leftMenu.appendChild(menuItem);
        });

        leftInput.addEventListener('click', function(e) {
            e.stopPropagation();
            leftMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', function(e) {
            if (!leftDropdown.contains(e.target)) {
                leftMenu.classList.add('hidden');
            }
        });

        leftDropdown.appendChild(leftInput);
        leftDropdown.appendChild(leftChevron);
        leftDropdown.appendChild(leftMenu);

        const rightInput = document.createElement('input');
        rightInput.type = 'text';
        rightInput.className = 'flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        rightInput.placeholder = '';
        rightInput.value = value;

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors flex-shrink-0';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            tagRow.remove();
            updateTagsCount(labelElement);
        });

        tagRow.appendChild(leftDropdown);
        tagRow.appendChild(rightInput);
        tagRow.appendChild(deleteButton);
        container.appendChild(tagRow);
        updateTagsCount(labelElement);
    }

    // Update "Tags (N)" label based on the number of tag rows.
    function updateTagsCount(labelElement) {
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        if (tagsRowsContainer && labelElement) {
            const tagRows = tagsRowsContainer.querySelectorAll('.flex.items-center.gap-2');
            const count = tagRows.length;
            labelElement.textContent = 'Tags (' + count + ')';
        }
    }

    // Fill the relations section of the side panel from request.relations_data.
    function populateRelationsData(relationsData) {
        if (!Array.isArray(relationsData) || relationsData.length === 0) return;
        
        const relationsRowsContainer = document.getElementById('relations-rows-container');
        const relationsLabel = document.getElementById('relations-label-span');
        
        if (!relationsRowsContainer || !relationsLabel) return;

        relationsData.forEach(function(relation) {
            if (relation.parent_relation || relation.role) {
                createRelationRow(relationsRowsContainer, relationsLabel, relation.parent_relation || 'New Relation', relation.role || '');
            }
        });
    }

    // Create a single editable relation row (parent + role).
    function createRelationRow(container, labelElement, parentRelation, role) {
        const relationRow = document.createElement('div');
        relationRow.className = 'space-y-2';
        const relationId = 'relation-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        relationRow.id = relationId;

        const parentRelationRow = document.createElement('div');
        parentRelationRow.className = 'flex items-center gap-2';

        const parentDropdown = document.createElement('div');
        parentDropdown.className = 'relative flex-1 min-w-0';

        const parentInput = document.createElement('input');
        parentInput.type = 'text';
        parentInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all cursor-pointer';
        parentInput.placeholder = 'Choose a parent relation';
        parentInput.value = parentRelation;
        parentInput.readOnly = true;

        const parentChevron = document.createElement('div');
        parentChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
        parentChevron.innerHTML = '<svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        const parentMenu = document.createElement('div');
        parentMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 hidden max-h-60 overflow-y-auto';

        const relationOptions = ['New Relation'];
        relationOptions.forEach(function(option) {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-3 py-2 text-xs text-zinc-900 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100 last:border-b-0';
            menuItem.textContent = option;
            menuItem.addEventListener('click', function(e) {
                e.stopPropagation();
                parentInput.value = option;
                parentMenu.classList.add('hidden');
            });
            parentMenu.appendChild(menuItem);
        });

        parentInput.addEventListener('click', function(e) {
            e.stopPropagation();
            parentMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', function(e) {
            if (!parentDropdown.contains(e.target)) {
                parentMenu.classList.add('hidden');
            }
        });

        parentDropdown.appendChild(parentInput);
        parentDropdown.appendChild(parentChevron);
        parentDropdown.appendChild(parentMenu);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors flex-shrink-0';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            relationRow.remove();
            updateRelationsCount(labelElement);
        });

        parentRelationRow.appendChild(parentDropdown);
        parentRelationRow.appendChild(deleteButton);

        const roleInput = document.createElement('input');
        roleInput.type = 'text';
        roleInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        roleInput.placeholder = 'Role';
        roleInput.value = role;

        relationRow.appendChild(parentRelationRow);
        relationRow.appendChild(roleInput);
        container.appendChild(relationRow);
        updateRelationsCount(labelElement);
    }

    // Update "Relations (N)" label based on the number of relation rows.
    function updateRelationsCount(labelElement) {
        const relationsRowsContainer = document.getElementById('relations-rows-container');
        if (relationsRowsContainer && labelElement) {
            const relationRows = relationsRowsContainer.querySelectorAll('.space-y-2');
            const count = relationRows.length;
            labelElement.textContent = 'Relations (' + count + ')';
        }
    }

    // Open the edit side panel and populate it with request metadata.
    function populateSidepanelWithRequestData(request) {
        const sidePanel = document.getElementById('editSidePanel');

        hideEditToolbarsForReview();

        if (!sidePanel) {
            return;
        }

        const isCurrentlyActive = !sidePanel.classList.contains('-translate-x-full');

        if (!isCurrentlyActive) {
            if (typeof window.initMapSidePanelChrome === 'function') {
                window.initMapSidePanelChrome();
            }
            if (typeof window.applyMapSidePanelOpen === 'function') {
                window.applyMapSidePanelOpen(true);
            } else {
                sidePanel.classList.remove('-translate-x-full');
                const mapContainer = document.getElementById('mapContainer');
                if (mapContainer) {
                    const SIDE_PANEL_WIDTH = 320;
                    mapContainer.style.marginLeft = SIDE_PANEL_WIDTH + 'px';
                    mapContainer.style.width = `calc(100% - ${SIDE_PANEL_WIDTH}px)`;
                    setTimeout(function() {
                        if (map && map.resize) {
                            map.resize();
                        }
                    }, 300);
                }
            }
        }
        hideEditToolbarsForReview();
        let retryCount = window.populateSidepanelRetryCount || 0;
        if (retryCount < 10) {
            if (sidePanel.classList.contains('-translate-x-full')) {
                window.populateSidepanelRetryCount = retryCount + 1;
                setTimeout(function() {
                    populateSidepanelWithRequestData(request);
                }, 200);
                return;
            }
            window.populateSidepanelRetryCount = 0;
        } else {
            window.populateSidepanelRetryCount = 0;
        }
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.updateCurrentFeatureLabel === 'function') {
            window.lineDrawingHandler.updateCurrentFeatureLabel(request.current_feature_label || 'Line');
        }
        setTimeout(function() {
            if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showEditFeatureScreen === 'function') {
                window.lineDrawingHandler.showEditFeatureScreen({
                    hideBackButton: true,
                    requestGeometry: request.geometry,
                    lineData: { road_closure: request.road_closure },
                });
            }
            hideEditToolbarsForReview();
            setTimeout(function() {
                hideEditToolbarsForReview();
                const editScreen = document.getElementById('editFeatureScreen');
                if (!editScreen) {
                    setTimeout(function() {
                        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showEditFeatureScreen === 'function') {
                            window.lineDrawingHandler.showEditFeatureScreen();
                        }
                        setTimeout(function() {
                            if (request.fields_data) {
                                populateFieldsData(request.fields_data);
                            }
                            if (request.tags_data) {
                                populateTagsData(request.tags_data);
                            }
                            if (request.relations_data) {
                                populateRelationsData(request.relations_data);
                            }
                        }, 300);
                    }, 200);
                    return;
                }
                if (request.fields_data) {
                    populateFieldsData(request.fields_data);
                }
                if (request.tags_data) {
                    populateTagsData(request.tags_data);
                }
                if (request.relations_data) {
                    populateRelationsData(request.relations_data);
                }
            }, 400);
        }, 200);
    }

    // Fill the main fields section of the side panel from request.fields_data.
    function populateFieldsData(fieldsData) {
        const fieldsContainer = document.getElementById('fields-container');
        if (!fieldsContainer || !fieldsData) return;
        const byId = document.getElementById('sidebar-feature-name-input');
        if (byId) {
            const n = fieldsData.name != null ? String(fieldsData.name).trim() : '';
            const c = fieldsData.common_name != null ? String(fieldsData.common_name).trim() : '';
            byId.value = n || c || '';
        } else {
            const nameFieldGroup = fieldsContainer.querySelector('.ms-sidebar-field-group');
            const fallbackNameInput = nameFieldGroup && nameFieldGroup.querySelector('input[type="text"]');
            if (fallbackNameInput) {
                if (fieldsData.name) {
                    fallbackNameInput.value = fieldsData.name;
                } else if (fieldsData.common_name) {
                    fallbackNameInput.value = fieldsData.common_name;
                }
            }
        }
        if (fieldsData.multilingual_names && Array.isArray(fieldsData.multilingual_names)) {
            fieldsData.multilingual_names.forEach(function(multilingual) {
                if (multilingual.language && multilingual.name) {
                    let multilingualSection = null;
                    if (typeof window.addMultilingualNameField === 'function') {
                        window.addMultilingualNameField(fieldsContainer);
                        setTimeout(function() {
                            const multilingualSections = fieldsContainer.querySelectorAll('[id^="multilingual-"]');
                            if (multilingualSections.length > 0) {
                                multilingualSection = multilingualSections[multilingualSections.length - 1];
                                const languageSelect = multilingualSection.querySelector('select');
                                const nameInput = multilingualSection.querySelector('input[type="text"]');
                                if (languageSelect) languageSelect.value = multilingual.language;
                                if (nameInput) nameInput.value = multilingual.name;
                            }
                        }, 50);
                    } else {
                        createMultilingualNameField(fieldsContainer, multilingual.language, multilingual.name);
                    }
                }
            });
        }
        const fieldMappings = {
            'description': { id: 'description', name: 'Description' },
            'fix_me': { id: 'fix-me', name: 'Fix Me' },
            'image': { id: 'image', name: 'Image' },
            'last_checked_date': { id: 'last-checked-date', name: 'Last Checked Date' },
            'mapillary_image_id': { id: 'mapillary-image-id', name: 'Mapillary Image ID' },
            'note': { id: 'note', name: 'Note' },
            'panoramax_image_id': { id: 'panoramax-image-id', name: 'Panoramax Image ID' },
            'website': { id: 'website', name: 'Website' }
        };

        Object.keys(fieldMappings).forEach(function(fieldKey) {
            if (fieldsData[fieldKey]) {
                const fieldInfo = fieldMappings[fieldKey];
                const fieldId = fieldInfo.id;
                const existingField = document.getElementById('field-' + fieldId);
                if (!existingField) {
                    if (typeof window.addFieldToContainer === 'function') {
                        window.addFieldToContainer(fieldInfo.name, fieldId, fieldsContainer);
                        if (typeof window.selectedFields === 'undefined') {
                            window.selectedFields = [];
                        }
                        if (window.selectedFields.indexOf(fieldId) === -1) {
                            window.selectedFields.push(fieldId);
                        }
                        setTimeout(function() {
                            const fieldElement = document.getElementById('field-' + fieldId);
                            if (fieldElement) {
                                const input = fieldElement.querySelector('input, textarea');
                                if (input) {
                                    input.value = fieldsData[fieldKey];
                                }
                            }
                        }, 150);
                    }
                } else {
                    const input = existingField.querySelector('input, textarea');
                    if (input) {
                        input.value = fieldsData[fieldKey];
                    }
                }
            }
        });
        setTimeout(function() {
            if (typeof window.updateAddFieldDisplay === 'function') {
                window.updateAddFieldDisplay();
            }
        }, 200);
        if (typeof window.syncRemoveRoadLabelButtonVisibility === 'function') {
            window.syncRemoveRoadLabelButtonVisibility();
        }
    }

    // Add a multilingual-name block under the fields section.
    function createMultilingualNameField(fieldsContainer, language, name) {
        const multilingualSection = document.createElement('div');
        multilingualSection.className = 'ms-sidebar-field-group bg-zinc-100 rounded-lg border border-zinc-200 p-3 space-y-2.5';
        multilingualSection.id = 'multilingual-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        const headerRow = document.createElement('div');
        headerRow.className = 'flex items-center justify-between';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-xs font-medium text-zinc-900';
        labelSpan.textContent = 'Multilingual Name';
        headerRow.appendChild(labelSpan);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-200/80 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            multilingualSection.remove();
        });
        headerRow.appendChild(deleteButton);

        multilingualSection.appendChild(headerRow);

        const languageDropdown = document.createElement('div');
        languageDropdown.className = 'relative';

        const languageSelect = document.createElement('select');
        languageSelect.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 pr-8 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all appearance-none cursor-pointer';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Choose language';
        defaultOption.disabled = true;
        languageSelect.appendChild(defaultOption);

        ['english', 'urdu', 'arabic'].forEach(function(lang) {
            const option = document.createElement('option');
            option.value = lang;
            option.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
            languageSelect.appendChild(option);
        });

        languageSelect.value = language || '';
        languageDropdown.appendChild(languageSelect);
        multilingualSection.appendChild(languageDropdown);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'w-full bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all';
        nameInput.placeholder = 'Name';
        nameInput.value = name || '';
        multilingualSection.appendChild(nameInput);

        const addFieldSection = document.getElementById('add-field-section');
        if (addFieldSection && addFieldSection.parentNode) {
            addFieldSection.parentNode.insertBefore(multilingualSection, addFieldSection);
        } else {
            fieldsContainer.appendChild(multilingualSection);
        }
    }

    // Show the bottom-center review card (Approve / Reject) after map focus.
    function showRequestDetailsSidepanel(request) {
        setTimeout(function() {
            createApproveRejectButtons(request);
        }, 1000);
    }

    // Create the Approve / Reject floating buttons for the active request.
    function createApproveRejectButtons(request) {
        removeApproveRejectButtons();

        const mapContainer = document.getElementById('mapContainer') || document.querySelector('.mapboxgl-map');
        if (!mapContainer) {
            return;
        }
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'approveRejectButtonsContainer';
        buttonContainer.className = 'fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex gap-3 items-center';
        buttonContainer.style.pointerEvents = 'auto';
        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-2xl border border-gray-300 px-4 py-3 flex flex-wrap gap-3 items-center max-w-lg';
        card.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.2)';
        const infoText = document.createElement('span');
        infoText.className = 'text-sm font-medium text-gray-800 mr-2';
        infoText.textContent = request.is_layer_upload
            ? 'Review Layer Upload'
            : 'Review Edit Request';
        card.appendChild(infoText);
        const approveBtn = document.createElement('button');
        approveBtn.id = 'approveRequestBtn';
        approveBtn.className = 'px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 transition-colors text-sm font-medium flex items-center justify-center gap-2 shadow-md';
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
        rejectBtn.className = 'px-4 py-2 bg-white text-black border border-gray-300 rounded-md hover:bg-gray-100 transition-colors text-sm font-medium flex items-center justify-center gap-2 shadow-md';
        rejectBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            Reject
        `;
        rejectBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('Are you sure you want to reject this edit request?')) {
                rejectRequest(request.id);
            }
        });
        card.appendChild(rejectBtn);

        if (request.geometry_changed && request.original_geometry) {
            const legend = document.createElement('div');
            legend.className = 'text-[11px] text-gray-600 flex flex-col gap-1 border-t border-gray-200 pt-2 mt-1';
            legend.innerHTML = '<span><span class="font-medium text-gray-600">━━</span> Gray dashed: original</span>'
                + '<span><span class="font-medium text-gray-900">━━</span> Solid: proposed</span>'
                + '<span><span class="font-medium text-orange-600">━━</span> Orange: changed segments</span>';
            card.appendChild(legend);
        }

        buttonContainer.appendChild(card);
        document.body.appendChild(buttonContainer);
        window.currentReviewingRequestId = request.id;
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
                alert(data.message || 'Edit request approved successfully!');
                cleanupRequestLines();
                removeApproveRejectButtons();
                approvalQueue = approvalQueue.filter(function(req) {
                    return req.id !== requestId;
                });
                renderApprovalList();
                if (data.deleted_road_id != null) {
                    if (typeof window.clearRiyadhRoadDbFclassFromDatabase === 'function') {
                        window.clearRiyadhRoadDbFclassFromDatabase(data.deleted_road_id);
                    }
                    try {
                        window.selectedRiyadhRoad = null;
                        window.approvedLineBeingEdited = null;
                        if (typeof window.setSelectedOverlayGeometry === 'function') {
                            window.setSelectedOverlayGeometry(null);
                        }
                    } catch (eSel) {}
                } else if (
                    data.remote_road_id != null &&
                    typeof window.applyRiyadhRoadDbFclassFromDatabase === 'function'
                ) {
                    window.applyRiyadhRoadDbFclassFromDatabase(
                        data.remote_road_id,
                        data.fclass || 'unclassified'
                    );
                }
                if (typeof window.triggerRiyadhTilesReload === 'function') {
                    window.triggerRiyadhTilesReload(
                        data.tiles_version != null ? data.tiles_version : Date.now()
                    );
                }
            } else {
                alert('Error: ' + (data.message || 'Approval failed'));
            }
        })
        .catch(function() {
            alert('Error approving request');
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
                alert(data.message || 'Edit request rejected');
                cleanupRequestLines();
                removeApproveRejectButtons();
                approvalQueue = approvalQueue.filter(function(req) {
                    return req.id !== requestId;
                });
                renderApprovalList();
            } else {
                alert('Error: ' + data.message);
            }
        })
        .catch(function(error) {
            alert('Error rejecting request');
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

    function initApprovalQueue() {
        buildApprovalWidget();
        refreshApprovalQueue();
        setInterval(refreshApprovalQueue, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApprovalQueue);
    } else {
        initApprovalQueue();
    }

    window.refreshApprovalQueue = refreshApprovalQueue;
    window.populateFieldsData = populateFieldsData;
    window.populateTagsData = populateTagsData;
    window.populateRelationsData = populateRelationsData;

})();

