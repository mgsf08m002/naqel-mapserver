/**
 * Map road-name search (EN/AR): draggable toggle, debounced API lookup,
 * zoom to geometry, open road details.
 *
 * Depends on: geotrakMaplibreMap (map.js), openRiyadhRoadById (map-road-select.js).
 * Exports: geotrakZoomToRoadGeometry (also used by deeplink + outcome bell).
 */
(function (global) {
    'use strict';

    var MIN_QUERY_LEN = 2;
    var SEARCH_LIMIT = 12;
    var DEBOUNCE_MS = 280;
    var DRAG_THRESHOLD_PX = 6;
    var EDGE_PX = 8;
    var POSITION_STORAGE_KEY = 'geotrak.mapRoadSearch.position.v2';
    var SEARCH_URL = '/mapping/api/riyadh-road-search/';

    function uiT(key, fallback) {
        if (typeof global.uiT === 'function') {
            return global.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function notify(message, type) {
        if (global.notify && typeof global.notify.tryShow === 'function') {
            global.notify.tryShow(message, type || 'info');
            return;
        }
        if (type === 'error') {
            console.warn(message);
        }
    }

    function getMap() {
        var map = global.geotrakMaplibreMap;
        return map && typeof map.flyTo === 'function' ? map : null;
    }

    function getMapContainer() {
        return document.getElementById('mapContainer');
    }

    // --- Zoom helpers (shared export) ---

    function bboxFromGeometry(geometry) {
        if (!geometry || !geometry.coordinates) {
            return null;
        }
        var minLng = Infinity;
        var minLat = Infinity;
        var maxLng = -Infinity;
        var maxLat = -Infinity;

        function visit(coords) {
            if (!coords || !coords.length) {
                return;
            }
            if (typeof coords[0] === 'number') {
                var lng = coords[0];
                var lat = coords[1];
                if (lng < minLng) minLng = lng;
                if (lat < minLat) minLat = lat;
                if (lng > maxLng) maxLng = lng;
                if (lat > maxLat) maxLat = lat;
                return;
            }
            for (var i = 0; i < coords.length; i++) {
                visit(coords[i]);
            }
        }

        visit(geometry.coordinates);
        if (!Number.isFinite(minLng)) {
            return null;
        }
        return [
            [minLng, minLat],
            [maxLng, maxLat],
        ];
    }

    function zoomToGeometry(geometry) {
        var map = getMap();
        if (!map || !geometry) {
            notify(uiT('toast_map_loading', 'Map still loading'), 'error');
            return;
        }
        var bounds = bboxFromGeometry(geometry);
        if (!bounds) {
            return;
        }
        var west = bounds[0][0];
        var south = bounds[0][1];
        var east = bounds[1][0];
        var north = bounds[1][1];
        var center = [(west + east) / 2, (south + north) / 2];
        var spanLng = Math.abs(east - west);
        var spanLat = Math.abs(north - south);
        var flyOpts = { center: center, duration: 900, essential: true };

        if (spanLng < 1e-6 && spanLat < 1e-6) {
            map.flyTo(Object.assign({}, flyOpts, { zoom: 17 }));
            return;
        }
        if (typeof map.fitBounds === 'function') {
            try {
                map.fitBounds(
                    [
                        [west, south],
                        [east, north],
                    ],
                    { padding: 72, maxZoom: 17, duration: 900 }
                );
                return;
            } catch (e) {}
        }
        map.flyTo(Object.assign({}, flyOpts, { zoom: 16 }));
    }

    // --- Search API ---

    function alternateNameLabel(item) {
        if (!item) {
            return '';
        }
        var primary = String(item.display_name || '').trim();
        var ar = String(item.name_ar || '').trim();
        var en = String(item.name_en || '').trim();
        if (ar && ar !== primary) {
            return ar;
        }
        if (en && en !== primary) {
            return en;
        }
        return '';
    }

    async function fetchSearchResults(query) {
        var url =
            SEARCH_URL +
            '?q=' +
            encodeURIComponent(query) +
            '&limit=' +
            String(SEARCH_LIMIT);
        var resp = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });
        var data = null;
        try {
            data = await resp.json();
        } catch (e) {
            data = null;
        }
        if (!resp.ok || !data) {
            return {
                success: false,
                message: searchUnavailableMessage(data),
                results: [],
            };
        }
        return data;
    }

    function searchUnavailableMessage(payload) {
        var fallback = uiT(
            'toast_search_unavailable',
            'Search is temporarily unavailable'
        );
        if (typeof global.safeUserMessage === 'function') {
            return global.safeUserMessage(payload, fallback);
        }
        return fallback;
    }

    async function selectSearchResult(result) {
        if (!result || result.id == null) {
            return;
        }
        if (result.geometry) {
            zoomToGeometry(result.geometry);
        }
        if (typeof global.openRiyadhRoadById !== 'function') {
            notify(uiT('toast_map_loading', 'Map still loading'), 'error');
            return;
        }
        var opened = await global.openRiyadhRoadById(
            result.id,
            {
                name:
                    result.display_name ||
                    result.name_en ||
                    result.name_ar ||
                    '',
            },
            { enterEditMode: false }
        );
        if (!opened.success) {
            var fallback = uiT(
                'toast_couldnt_open_road',
                "Couldn't open road"
            );
            notify(
                typeof global.safeUserMessage === 'function'
                    ? global.safeUserMessage(opened, fallback)
                    : fallback,
                'error'
            );
        }
    }

    // --- Draggable toggle position ---

    function chromeTopMargin() {
        var raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--app-chrome-offset')
            .trim();
        var offsetPx;
        if (/rem$/i.test(raw)) {
            var rem = parseFloat(raw);
            var rootFs =
                parseFloat(getComputedStyle(document.documentElement).fontSize) ||
                16;
            offsetPx = rem * rootFs;
        } else {
            offsetPx = parseFloat(raw);
        }
        if (!Number.isFinite(offsetPx) || offsetPx <= 0) {
            offsetPx = 78;
        }
        return Math.round(offsetPx + 6);
    }

    function initDrag(root, handle) {
        var container = getMapContainer();
        if (!container) {
            return {
                suppressClick: function () {
                    return false;
                },
            };
        }

        var dragState = null;
        var suppressClick = false;
        var currentX = null;
        var currentY = null;

        function containerSize() {
            var rect = container.getBoundingClientRect();
            return {
                width: container.clientWidth || rect.width || 0,
                height: container.clientHeight || rect.height || 0,
            };
        }

        function clampPosition(x, y) {
            var size = containerSize();
            var btnW = root.offsetWidth || 36;
            var btnH = root.offsetHeight || 36;
            var minY = chromeTopMargin();
            var maxX = Math.max(EDGE_PX, size.width - btnW - EDGE_PX);
            var maxY = Math.max(minY, size.height - btnH - EDGE_PX);
            return {
                x: Math.min(Math.max(EDGE_PX, x), maxX),
                y: Math.min(Math.max(minY, y), maxY),
            };
        }

        function applyPosition(x, y) {
            var pos = clampPosition(x, y);
            currentX = pos.x;
            currentY = pos.y;
            root.classList.add('is-positioned');
            root.style.inset = 'auto';
            root.style.left = Math.round(pos.x) + 'px';
            root.style.top = Math.round(pos.y) + 'px';
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            return pos;
        }

        function defaultPosition() {
            var size = containerSize();
            var btnW = root.offsetWidth || 36;
            return applyPosition(size.width - btnW - 12, chromeTopMargin());
        }

        function readSavedPosition() {
            try {
                var raw = global.localStorage.getItem(POSITION_STORAGE_KEY);
                if (!raw) {
                    return null;
                }
                var parsed = JSON.parse(raw);
                if (
                    parsed &&
                    Number.isFinite(parsed.xr) &&
                    Number.isFinite(parsed.yr)
                ) {
                    return { xr: parsed.xr, yr: parsed.yr };
                }
            } catch (e) {}
            return null;
        }

        function savePosition(x, y) {
            var size = containerSize();
            var btnW = root.offsetWidth || 36;
            var btnH = root.offsetHeight || 36;
            var spanX = Math.max(1, size.width - btnW - EDGE_PX * 2);
            var spanY = Math.max(1, size.height - btnH - EDGE_PX * 2);
            var xr = (x - EDGE_PX) / spanX;
            var yr = (y - chromeTopMargin()) / spanY;
            try {
                global.localStorage.setItem(
                    POSITION_STORAGE_KEY,
                    JSON.stringify({
                        xr: Math.min(1, Math.max(0, xr)),
                        yr: Math.min(1, Math.max(0, yr)),
                    })
                );
            } catch (e) {}
        }

        function restoreOrDefault() {
            var size = containerSize();
            if (size.width < 40 || size.height < 40) {
                return false;
            }
            var saved = readSavedPosition();
            if (saved) {
                var btnW = root.offsetWidth || 36;
                var btnH = root.offsetHeight || 36;
                var spanX = Math.max(1, size.width - btnW - EDGE_PX * 2);
                var spanY = Math.max(1, size.height - btnH - EDGE_PX * 2);
                applyPosition(
                    EDGE_PX + saved.xr * spanX,
                    chromeTopMargin() + saved.yr * spanY
                );
            } else {
                defaultPosition();
            }
            return true;
        }

        function reclampToCurrent() {
            if (currentX == null || currentY == null) {
                restoreOrDefault();
                return;
            }
            applyPosition(currentX, currentY);
        }

        if (!restoreOrDefault()) {
            requestAnimationFrame(function () {
                if (!restoreOrDefault()) {
                    setTimeout(restoreOrDefault, 50);
                }
            });
        }

        function endDrag(e) {
            if (!dragState || e.pointerId !== dragState.pointerId) {
                return;
            }
            if (dragState.moved) {
                var pos = applyPosition(currentX, currentY);
                savePosition(pos.x, pos.y);
                suppressClick = true;
            }
            dragState = null;
            root.classList.remove('map-road-search--dragging');
            try {
                handle.releasePointerCapture(e.pointerId);
            } catch (err) {}
        }

        handle.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 && e.pointerType === 'mouse') {
                return;
            }
            if (currentX == null || currentY == null) {
                restoreOrDefault();
            }
            var containerRect = container.getBoundingClientRect();
            var rootRect = root.getBoundingClientRect();
            dragState = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                originX: rootRect.left - containerRect.left,
                originY: rootRect.top - containerRect.top,
                moved: false,
            };
            try {
                handle.setPointerCapture(e.pointerId);
            } catch (err) {}
        });

        handle.addEventListener('pointermove', function (e) {
            if (!dragState || e.pointerId !== dragState.pointerId) {
                return;
            }
            var dx = e.clientX - dragState.startX;
            var dy = e.clientY - dragState.startY;
            if (
                !dragState.moved &&
                (Math.abs(dx) > DRAG_THRESHOLD_PX ||
                    Math.abs(dy) > DRAG_THRESHOLD_PX)
            ) {
                dragState.moved = true;
                root.classList.add('map-road-search--dragging');
            }
            if (!dragState.moved) {
                return;
            }
            e.preventDefault();
            applyPosition(dragState.originX + dx, dragState.originY + dy);
        });

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        global.addEventListener('resize', reclampToCurrent);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(reclampToCurrent).observe(container);
        }

        return {
            suppressClick: function () {
                if (!suppressClick) {
                    return false;
                }
                suppressClick = false;
                return true;
            },
        };
    }

    // --- Panel UI ---

    function initMapRoadSearch() {
        var root = document.getElementById('mapRoadSearch');
        var toggle = document.getElementById('mapRoadSearchToggle');
        var overlay = document.getElementById('mapRoadSearchOverlay');
        var panel = document.getElementById('mapRoadSearchPanel');
        var input = document.getElementById('mapRoadSearchInput');
        var list = document.getElementById('mapRoadSearchResults');
        var status = document.getElementById('mapRoadSearchStatus');

        if (!root || !toggle || !overlay || !panel || !input || !list) {
            return;
        }

        var drag = initDrag(root, toggle);
        var debounceTimer = null;
        var activeRequest = 0;

        function isOpen() {
            return overlay.classList.contains('is-open');
        }

        function setStatus(text) {
            if (!status) {
                return;
            }
            status.textContent = text || '';
            status.classList.toggle('is-empty', !text);
        }

        function closePanel() {
            if (!isOpen()) {
                return;
            }
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
            root.classList.remove('map-road-search--above-overlay');
            toggle.setAttribute('aria-expanded', 'false');
            input.blur();
        }

        function openPanel() {
            if (isOpen()) {
                return;
            }
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
            root.classList.add('map-road-search--above-overlay');
            toggle.setAttribute('aria-expanded', 'true');
            // Focus after the open animation starts so the caret feels intentional.
            window.setTimeout(function () {
                if (isOpen()) {
                    input.focus();
                }
            }, 80);
        }

        function renderResults(items) {
            list.innerHTML = '';
            if (!items || !items.length) {
                setStatus(uiT('road_search_empty', 'No roads found.'));
                return;
            }
            setStatus(
                items.length === 1
                    ? uiT('road_search_match_one', '1 match. Press Enter.')
                    : uiT('road_search_match_many', '{n} matches').replace(
                          '{n}',
                          String(items.length)
                      )
            );
            items.forEach(function (item) {
                var li = document.createElement('li');
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'map-road-search__result';

                var primary = document.createElement('span');
                primary.className = 'map-road-search__result-primary';
                primary.dir = 'auto';
                primary.textContent =
                    item.display_name || uiT('unnamed_road', 'Unnamed Road');
                btn.appendChild(primary);

                var secondary = alternateNameLabel(item);
                if (secondary) {
                    var secondaryEl = document.createElement('span');
                    secondaryEl.className = 'map-road-search__result-secondary';
                    secondaryEl.dir = 'auto';
                    secondaryEl.textContent = secondary;
                    btn.appendChild(secondaryEl);
                }

                btn.addEventListener('click', function () {
                    selectSearchResult(item);
                    closePanel();
                });
                li.appendChild(btn);
                list.appendChild(li);
            });
        }

        async function runSearch(fromEnter) {
            var q = input.value.trim();
            if (q.length < MIN_QUERY_LEN) {
                list.innerHTML = '';
                setStatus(
                    uiT(
                        'road_search_min_chars',
                        'Enter at least {n} characters to search.'
                    ).replace('{n}', String(MIN_QUERY_LEN))
                );
                return;
            }

            var reqId = ++activeRequest;
            setStatus(uiT('road_search_searching', 'Searching…'));
            try {
                var data = await fetchSearchResults(q);
                if (reqId !== activeRequest) {
                    return;
                }
                if (!data.success) {
                    list.innerHTML = '';
                    setStatus(searchUnavailableMessage(data));
                    return;
                }
                var items = data.results || [];
                renderResults(items);
                if (fromEnter && items.length) {
                    await selectSearchResult(items[0]);
                    closePanel();
                }
            } catch (e) {
                if (reqId === activeRequest) {
                    list.innerHTML = '';
                    setStatus(searchUnavailableMessage(null));
                }
            }
        }

        toggle.addEventListener('click', function () {
            if (drag.suppressClick()) {
                return;
            }
            if (isOpen()) {
                closePanel();
            } else {
                openPanel();
            }
        });

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closePanel();
            }
        });

        input.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                runSearch(false);
            }, DEBOUNCE_MS);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runSearch(true);
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) {
                closePanel();
            }
        });
    }

    if (document.getElementById('mapRoadSearch')) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initMapRoadSearch);
        } else {
            initMapRoadSearch();
        }
    }

    global.geotrakZoomToRoadGeometry = zoomToGeometry;
})(typeof window !== 'undefined' ? window : this);
