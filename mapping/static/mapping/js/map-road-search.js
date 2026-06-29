/**
 * Road name search on the map (English or Arabic): zoom to match, open road details.
 * Requires map-road-select.js (openRiyadhRoadById) and geotrakMaplibreMap from map.js.
 */
(function (global) {
    'use strict';

    var MIN_QUERY_LEN = 2;
    var SEARCH_LIMIT = 12;
    var DEBOUNCE_MS = 280;
    var DRAG_THRESHOLD_PX = 6;
    var POSITION_STORAGE_KEY = 'geotrak.mapRoadSearch.position';
    var SEARCH_URL = '/mapping/api/riyadh-road-search/';

    function getMap() {
        var map = global.geotrakMaplibreMap;
        return map && typeof map.flyTo === 'function' ? map : null;
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
        return [[minLng, minLat], [maxLng, maxLat]];
    }

    function zoomToGeometry(geometry) {
        var map = getMap();
        if (!map || !geometry) {
            notify('Map is still loading. Try again in a moment.', 'error');
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

    function resultSecondaryLabel(item) {
        if (!item) {
            return '';
        }
        if (item.name_en && item.name_ar && item.name_en !== item.name_ar) {
            return item.name_en + ' · ' + item.name_ar;
        }
        if (item.name_ar && item.display_name !== item.name_ar) {
            return item.name_ar;
        }
        if (item.name_en && item.display_name !== item.name_en) {
            return item.name_en;
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
        var data = await resp.json();
        if (!resp.ok || !data) {
            return {
                success: false,
                message: (data && data.message) || 'Search failed.',
                results: [],
            };
        }
        return data;
    }

    async function selectSearchResult(result) {
        if (!result || result.id == null) {
            return;
        }
        if (result.geometry) {
            zoomToGeometry(result.geometry);
        }
        if (typeof global.openRiyadhRoadById !== 'function') {
            notify('Map is still loading. Try again in a moment.', 'error');
            return;
        }
        var opened = await global.openRiyadhRoadById(
            result.id,
            { name: result.display_name || result.name_en || result.name_ar || '' },
            { enterEditMode: false }
        );
        if (!opened.success) {
            notify(opened.message || 'Could not open that road.', 'error');
        }
    }

    function getMapContainer() {
        return document.getElementById('mapContainer');
    }

    function initDrag(root, handle) {
        var container = getMapContainer();
        if (!container) {
            return { suppressClick: function () { return false; } };
        }

        var dragState = null;
        var suppressClick = false;

        function readSavedPosition() {
            try {
                var raw = global.localStorage.getItem(POSITION_STORAGE_KEY);
                if (!raw) {
                    return null;
                }
                var parsed = JSON.parse(raw);
                if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
                    return { x: parsed.x, y: parsed.y };
                }
            } catch (e) {}
            return null;
        }

        function savePosition(x, y) {
            try {
                global.localStorage.setItem(
                    POSITION_STORAGE_KEY,
                    JSON.stringify({ x: x, y: y })
                );
            } catch (e) {}
        }

        function applyPosition(x, y) {
            root.style.left = Math.round(x) + 'px';
            root.style.top = Math.round(y) + 'px';
            root.style.right = 'auto';
            root.style.bottom = 'auto';
        }

        function clampPosition(x, y) {
            var maxX = Math.max(8, container.clientWidth - root.offsetWidth - 8);
            var maxY = Math.max(8, container.clientHeight - root.offsetHeight - 8);
            return {
                x: Math.min(Math.max(8, x), maxX),
                y: Math.min(Math.max(8, y), maxY),
            };
        }

        function defaultPosition() {
            var margin = 12;
            var clamped = clampPosition(
                container.clientWidth - root.offsetWidth - margin,
                margin
            );
            applyPosition(clamped.x, clamped.y);
        }

        var saved = readSavedPosition();
        if (saved) {
            var clamped = clampPosition(saved.x, saved.y);
            applyPosition(clamped.x, clamped.y);
        } else {
            requestAnimationFrame(defaultPosition);
        }

        function endDrag(e) {
            if (!dragState || e.pointerId !== dragState.pointerId) {
                return;
            }
            if (dragState.moved) {
                var clamped = clampPosition(
                    parseFloat(root.style.left) || 0,
                    parseFloat(root.style.top) || 0
                );
                applyPosition(clamped.x, clamped.y);
                savePosition(clamped.x, clamped.y);
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
                (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
            ) {
                dragState.moved = true;
                root.classList.add('map-road-search--dragging');
            }
            if (!dragState.moved) {
                return;
            }
            e.preventDefault();
            var pos = clampPosition(dragState.originX + dx, dragState.originY + dy);
            applyPosition(pos.x, pos.y);
        });

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);

        global.addEventListener('resize', function () {
            var clamped = clampPosition(
                parseFloat(root.style.left) || 0,
                parseFloat(root.style.top) || 0
            );
            applyPosition(clamped.x, clamped.y);
        });

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
            return !overlay.classList.contains('hidden');
        }

        function setStatus(text) {
            if (!status) {
                return;
            }
            status.textContent = text || '';
            status.classList.toggle('hidden', !text);
        }

        function closePanel() {
            overlay.classList.add('hidden');
            overlay.setAttribute('aria-hidden', 'true');
            root.classList.remove('map-road-search--above-overlay');
            toggle.setAttribute('aria-expanded', 'false');
        }

        function openPanel() {
            overlay.classList.remove('hidden');
            overlay.setAttribute('aria-hidden', 'false');
            root.classList.add('map-road-search--above-overlay');
            toggle.setAttribute('aria-expanded', 'true');
            input.focus();
        }

        function renderResults(items) {
            list.innerHTML = '';
            if (!items || !items.length) {
                setStatus('No roads found.');
                return;
            }
            setStatus(
                items.length === 1 ? '1 match — press Enter' : items.length + ' matches'
            );
            items.forEach(function (item) {
                var li = document.createElement('li');
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'map-road-search__result';
                var primary = document.createElement('span');
                primary.className = 'map-road-search__result-primary';
                primary.textContent = item.display_name || 'Unnamed road';
                btn.appendChild(primary);
                var secondary = resultSecondaryLabel(item);
                if (secondary) {
                    var secondaryEl = document.createElement('span');
                    secondaryEl.className = 'map-road-search__result-secondary';
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
                setStatus('Enter at least ' + MIN_QUERY_LEN + ' characters to search.');
                return;
            }
            var reqId = ++activeRequest;
            setStatus('Searching…');
            try {
                var data = await fetchSearchResults(q);
                if (reqId !== activeRequest) {
                    return;
                }
                if (!data.success) {
                    renderResults([]);
                    setStatus(data.message || 'Search failed.');
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
                    renderResults([]);
                    setStatus('Search failed.');
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

        panel.addEventListener('click', function (e) {
            e.stopPropagation();
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
                input.blur();
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
