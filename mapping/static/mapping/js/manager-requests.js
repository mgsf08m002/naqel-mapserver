// Manager pending edit requests: UI, loading, map rendering and approval flow.
(function() {
    'use strict';

    let pendingRequests = [];
    let currentViewingRequest = null;

    // Build the floating panel that lists all pending edit requests.
    function createManagerRequestsUI() {
        const container = document.createElement('div');
        container.id = 'managerRequestsContainer';
        container.className = 'fixed top-20 right-16 z-40 w-80 max-h-[calc(100vh-6rem)] bg-white rounded-lg shadow-lg border border-gray-300 overflow-hidden flex flex-col';
        container.style.display = 'none';

        const header = document.createElement('div');
        header.className = 'bg-black px-4 py-3 flex items-center justify-between';
        
        const title = document.createElement('h2');
        title.className = 'text-sm font-semibold text-white';
        title.textContent = 'Pending Edit Requests';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'text-white hover:text-gray-300 transition-colors';
        closeBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
        closeBtn.addEventListener('click', function() {
            container.style.display = 'none';
            removeApproveRejectButtons();
        });
        header.appendChild(closeBtn);

        container.appendChild(header);

        const requestsList = document.createElement('div');
        requestsList.id = 'pendingRequestsList';
        requestsList.className = 'flex-1 overflow-y-auto p-3 space-y-2';
        container.appendChild(requestsList);

        const emptyState = document.createElement('div');
        emptyState.id = 'emptyRequestsState';
        emptyState.className = 'flex flex-col items-center justify-center py-8 text-gray-500';
        emptyState.innerHTML = `
            <svg class="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <p class="text-xs font-medium">No pending requests</p>
            <p class="text-xs mt-1 text-gray-400">All edit requests have been reviewed</p>
        `;
        requestsList.appendChild(emptyState);

        document.body.appendChild(container);
        return container;
    }

    // Build a single card row for one pending edit request.
    function createRequestCard(request) {
        const card = document.createElement('div');
        card.className = 'bg-white rounded border border-gray-300 p-3 hover:shadow-sm transition-shadow';
        card.setAttribute('data-request-id', request.id);

        const header = document.createElement('div');
        header.className = 'flex items-start gap-2 mb-2';

        const avatar = document.createElement('div');
        avatar.className = 'w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0';
        
        if (request.profile_image_url) {
            avatar.innerHTML = `<img src="${request.profile_image_url}" alt="${request.requester_name}" class="w-full h-full rounded-full object-cover">`;
        } else {
            avatar.textContent = request.requester_name.charAt(0).toUpperCase();
        }
        header.appendChild(avatar);

        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';

        const name = document.createElement('div');
        name.className = 'font-medium text-gray-900 text-xs truncate';
        name.textContent = request.requester_name;
        info.appendChild(name);

        const role = document.createElement('div');
        role.className = 'text-xs text-gray-600';
        role.textContent = request.requester_role;
        info.appendChild(role);

        header.appendChild(info);
        card.appendChild(header);

        const editType = document.createElement('div');
        editType.className = 'mb-2';
        const badge = document.createElement('span');
        const isDelete = (request.edit_type || '').toUpperCase() === 'DELETE';
        badge.className = isDelete
            ? 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200'
            : 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-300';
        badge.textContent = isDelete ? 'DELETE REQUEST' : request.edit_type;
        editType.appendChild(badge);
        card.appendChild(editType);

        const featureType = document.createElement('div');
        featureType.className = 'text-xs text-gray-700 mb-2';
        const displayFeatureType = request.current_feature_label || request.feature_type || 'Line';
        featureType.innerHTML = `<span class="font-medium">Feature:</span> ${displayFeatureType}`;
        card.appendChild(featureType);

        const date = document.createElement('div');
        date.className = 'text-xs text-gray-500 mb-2';
        const requestDate = new Date(request.created_at);
        date.textContent = requestDate.toLocaleDateString() + ' ' + requestDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        card.appendChild(date);

        const viewBtn = document.createElement('button');
        viewBtn.className = 'w-full px-3 py-1.5 bg-black text-white rounded hover:bg-gray-800 transition-colors text-xs font-medium';
        viewBtn.textContent = 'View Edit';
        viewBtn.addEventListener('click', function() {
            viewEditRequest(request.id);
        });
        card.appendChild(viewBtn);

        return card;
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

    // Fetch all pending edit requests for the current manager.
    function loadPendingRequests() {
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
                pendingRequests = data.requests;
                displayRequests();
                updateRequestsBadge();
            }
        })
        .catch(function() {});
    }

    // Render the pending requests list in the side panel.
    function displayRequests() {
        const container = document.getElementById('managerRequestsContainer');
        if (!container) return;

        const requestsList = document.getElementById('pendingRequestsList');
        if (!requestsList) return;

        requestsList.innerHTML = '';

        if (pendingRequests.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'flex flex-col items-center justify-center py-8 text-gray-500';
            emptyState.innerHTML = `
                <svg class="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <p class="text-xs font-medium">No pending requests</p>
                <p class="text-xs mt-1 text-gray-400">All edit requests have been reviewed</p>
            `;
            requestsList.appendChild(emptyState);
            return;
        }

        pendingRequests.forEach(function(request) {
            const card = createRequestCard(request);
            requestsList.appendChild(card);
        });
    }

    // Update the small badge count shown on the toggle button.
    function updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        if (badge) {
            badge.textContent = pendingRequests.length;
            if (pendingRequests.length === 0) {
                badge.style.display = 'none';
            } else {
                badge.style.display = 'inline-block';
            }
        }
    }

    // Load one specific edit request and hand it off to the map.
    function viewEditRequest(requestId) {
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
                currentViewingRequest = data.request;
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

    // Remove any previously drawn request features and markers from the map.
    function cleanupRequestLines() {
        if (typeof map === 'undefined' || !map) return;
        
        if (window.viewingRequestIds && window.viewingRequestIds.length > 0) {
            window.viewingRequestIds.forEach(function(featureId) {
                const sourceId = 'request-line-source-' + featureId;
                const glowLayerId = 'request-line-glow-' + featureId;
                const layerId = 'request-line-layer-' + featureId;
                
                try {
                    if (map.getLayer(layerId)) {
                        map.removeLayer(layerId);
                    }
                    if (map.getLayer(glowLayerId)) {
                        map.removeLayer(glowLayerId);
                    }
                    if (map.getSource(sourceId)) {
                        map.removeSource(sourceId);
                    }
                } catch (e) {}
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

        const container = document.getElementById('managerRequestsContainer');
        if (container) {
            container.style.display = 'none';
        }
        
        const normalizedGeometry = normalizeRequestGeometry(request.geometry);
        if (!normalizedGeometry || !normalizedGeometry.coordinates || normalizedGeometry.coordinates.length < 2) {
            if (window.notify && window.notify.warning) {
                window.notify.warning('This edit request has invalid geometry and cannot be shown on the map, but its details can still be reviewed.');
            } else {
                console.warn('Edit request has invalid geometry and cannot be shown on the map (request id: ' + request.id + ').');
            }

            ensureEditModeEnabled(function() {
                populateSidepanelWithRequestData(request);
                showRequestDetailsSidepanel(request);
            });
            return;
        }

        const requestForMap = Object.assign({}, request, { geometry: normalizedGeometry });

        const coordinates = normalizedGeometry.coordinates;

        let minLng = coordinates[0][0];
        let minLat = coordinates[0][1];
        let maxLng = coordinates[0][0];
        let maxLat = coordinates[0][1];
        
        coordinates.forEach(function(coord) {
            minLng = Math.min(minLng, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLng = Math.max(maxLng, coord[0]);
            maxLat = Math.max(maxLat, coord[1]);
        });
        
        const bounds = [[minLng, minLat], [maxLng, maxLat]];

        map.fitBounds(bounds, {
            padding: 100,
            duration: 1000
        });
        ensureEditModeEnabled(function() {
            setTimeout(function() {
                drawRequestLineOnMap(requestForMap);
                populateSidepanelWithRequestData(requestForMap);
                showRequestDetailsSidepanel(request);
            }, 1100);
        });
    }

    // Ensure the left edit side panel and toolbar are visible before populating.
    function ensureEditModeEnabled(callback) {
        const sidePanel = document.getElementById('editSidePanel');
        const mapContainer = document.getElementById('mapContainer');
        const editToolbar = document.getElementById('editToolbar');
        
        if (!sidePanel) {
            if (callback) setTimeout(callback, 100);
            return;
        }
        
        const isCurrentlyActive = !sidePanel.classList.contains('-translate-x-full');
        if (isCurrentlyActive) {
            if (callback) setTimeout(callback, 100);
            return;
        }
        sidePanel.classList.remove('-translate-x-full');
        if (editToolbar) {
            editToolbar.classList.remove('hidden');
        }
        if (mapContainer) {
            mapContainer.style.marginLeft = '320px';
            mapContainer.style.width = 'calc(100% - 320px)';
        }
        if (typeof map !== 'undefined' && map && map.resize) {
            setTimeout(function() {
                map.resize();
            }, 100);
        }
        setTimeout(function() {
            const isNowActive = !sidePanel.classList.contains('-translate-x-full');
            if (callback) callback();
        }, 400);
    }

    // Draw the request line on the map as a MapLibre layer.
    function drawRequestLineOnMap(request) {
        if (typeof map === 'undefined' || !map) {
            return;
        }

        const featureId = 'request-' + request.id;
        renderRequestLineAsMapLibreLayer(featureId, request);
        
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
        const glowLayerId = 'request-line-glow-' + featureId;
        const layerId = 'request-line-layer-' + featureId;

        const isRoadClosed = request.road_closure === 1 || request.road_closure === true || request.road_closure === '1';
        const getStyle = window.getVisualizationStyle;
        const closureStyle = typeof getStyle === "function" ? getStyle("Road Closure") : null;
        const featureStyle = typeof getStyle === "function" ? getStyle(request.current_feature_label || "Line") : null;
        const style = (isRoadClosed && closureStyle) ? closureStyle : featureStyle;
        if (!style) {
            return;
        }

        const lineDasharray = (style.lineDasharray && Array.isArray(style.lineDasharray)) ? style.lineDasharray : [1, 0];

        try {
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getLayer(glowLayerId)) {
                map.removeLayer(glowLayerId);
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
                id: glowLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': style.glowColor,
                    'line-width': style.glowWidth,
                    'line-opacity': style.glowOpacity,
                    'line-blur': 6
                }
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
        if (!Array.isArray(tagsData) || tagsData.length === 0) return;
        
        const tagsRowsContainer = document.getElementById('tags-rows-container');
        const tagsLabel = document.getElementById('tags-label-span');
        
        if (!tagsRowsContainer || !tagsLabel) return;

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
        leftInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer';
        leftInput.placeholder = 'Add new tag';
        leftInput.readOnly = true;
        leftInput.value = key;

        const leftChevron = document.createElement('div');
        leftChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
        leftChevron.innerHTML = '<svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        const leftMenu = document.createElement('div');
        leftMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-50 hidden max-h-60 overflow-y-auto';

        const tagOptions = ['building', 'highway', 'source', 'name', 'surface', 'natural', 'addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'];
        tagOptions.forEach(function(option) {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-3 py-2 text-xs text-white hover:bg-gray-600 cursor-pointer border-b border-gray-600 last:border-b-0';
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
        rightInput.className = 'flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
        rightInput.placeholder = '';
        rightInput.value = value;

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 transition-colors flex-shrink-0';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
        parentInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer';
        parentInput.placeholder = 'Choose a parent relation';
        parentInput.value = parentRelation;
        parentInput.readOnly = true;

        const parentChevron = document.createElement('div');
        parentChevron.className = 'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none';
        parentChevron.innerHTML = '<svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

        const parentMenu = document.createElement('div');
        parentMenu.className = 'absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-50 hidden max-h-60 overflow-y-auto';

        const relationOptions = ['New Relation'];
        relationOptions.forEach(function(option) {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-3 py-2 text-xs text-white hover:bg-gray-600 cursor-pointer border-b border-gray-600 last:border-b-0';
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
        deleteButton.className = 'w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 transition-colors flex-shrink-0';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            relationRow.remove();
            updateRelationsCount(labelElement);
        });

        parentRelationRow.appendChild(parentDropdown);
        parentRelationRow.appendChild(deleteButton);

        const roleInput = document.createElement('input');
        roleInput.type = 'text';
        roleInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
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
        const editToolbar = document.getElementById('editToolbar');
        
        if (!sidePanel) {
            return;
        }
        
        // Check if edit mode is already active
        const isCurrentlyActive = !sidePanel.classList.contains('-translate-x-full');
        
        if (!isCurrentlyActive) {
            sidePanel.classList.remove('-translate-x-full');
            
            // Adjust map container if needed
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
        if (editToolbar && editToolbar.classList.contains('hidden')) {
            editToolbar.classList.remove('hidden');
        }
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
                    requestGeometry: request.geometry
                });
            }
            setTimeout(function() {
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
        const nameFieldContainer = fieldsContainer.querySelector('.bg-gray-700.rounded-lg');
        if (nameFieldContainer) {
            const nameInput = nameFieldContainer.querySelector('input[type="text"]');
            if (nameInput && nameInput.placeholder && nameInput.placeholder.includes('Name')) {
                if (fieldsData.name) {
                    nameInput.value = fieldsData.name;
                }
            }
        }
        const commonNameInput = fieldsContainer.querySelector('.bg-gray-700.rounded-lg input[type="text"]:not([placeholder*="Name"])');
        if (commonNameInput && fieldsData.common_name) {
            commonNameInput.value = fieldsData.common_name;
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
    }

    // Add a multilingual-name block under the fields section.
    function createMultilingualNameField(fieldsContainer, language, name) {
        const multilingualSection = document.createElement('div');
        multilingualSection.className = 'bg-gray-700 rounded-lg p-3 space-y-2.5';
        multilingualSection.id = 'multilingual-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        const headerRow = document.createElement('div');
        headerRow.className = 'flex items-center justify-between';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-xs font-medium text-white';
        labelSpan.textContent = 'Multilingual Name';
        headerRow.appendChild(labelSpan);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600 transition-colors';
        deleteButton.innerHTML = '<svg class="w-3 h-3 text-white opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        deleteButton.addEventListener('click', function() {
            multilingualSection.remove();
        });
        headerRow.appendChild(deleteButton);

        multilingualSection.appendChild(headerRow);

        const languageDropdown = document.createElement('div');
        languageDropdown.className = 'relative';

        const languageSelect = document.createElement('select');
        languageSelect.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all appearance-none cursor-pointer';

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
        nameInput.className = 'w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all';
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
        card.className = 'bg-white rounded-lg shadow-2xl border border-gray-300 px-4 py-3 flex gap-3 items-center';
        card.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.2)';
        const infoText = document.createElement('span');
        infoText.className = 'text-sm font-medium text-gray-800 mr-2';
        infoText.textContent = 'Review Edit Request';
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
    }

    function approveRequest(requestId) {
        fetch('/mapping/api/request/' + requestId + '/approve/', {
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
                alert('Edit request approved successfully!');
                cleanupRequestLines();
                removeApproveRejectButtons();
                pendingRequests = pendingRequests.filter(function(req) {
                    return req.id !== requestId;
                });
                displayRequests();
                updateRequestsBadge();
                if (typeof window.triggerRiyadhTilesReload === 'function') {
                    window.triggerRiyadhTilesReload();
                } else {
                    window.location.reload();
                }
            } else {
                alert('Error: ' + data.message);
            }
        })
        .catch(function(error) {
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
                alert('Edit request rejected');
                cleanupRequestLines();
                removeApproveRejectButtons();
                pendingRequests = pendingRequests.filter(function(req) {
                    return req.id !== requestId;
                });
                displayRequests();
                updateRequestsBadge();
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

    function createToggleButton() {
        const button = document.createElement('button');
        button.id = 'managerRequestsToggle';
        button.className = 'fixed top-20 right-16 z-50 px-3 py-1.5 bg-black text-white rounded shadow-md hover:bg-gray-800 transition-colors flex items-center gap-2 text-sm font-medium';
        button.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <span>Edit Requests</span>
            <span id="requestsBadge" class="bg-gray-600 text-white text-xs px-1.5 py-0.5 rounded-full">0</span>
        `;
        
        button.addEventListener('click', function() {
            const container = document.getElementById('managerRequestsContainer');
            if (container) {
                const isVisible = container.style.display !== 'none';
                container.style.display = isVisible ? 'none' : 'flex';
                if (!isVisible) {
                    loadPendingRequests();
                } else {
                    removeApproveRejectButtons();
                }
            }
        });

        document.body.appendChild(button);
        return button;
    }

    function initManagerRequests() {
        createManagerRequestsUI();
        createToggleButton();
        loadPendingRequests();
        setInterval(loadPendingRequests, 30000);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initManagerRequests);
    } else {
        initManagerRequests();
    }

    window.loadPendingRequests = loadPendingRequests;
    window.populateFieldsData = populateFieldsData;
    window.populateTagsData = populateTagsData;
    window.populateRelationsData = populateRelationsData;

})();

