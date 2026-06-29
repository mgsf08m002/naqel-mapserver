/**
 * Open a Riyadh road from ?road=<tile_id> on map load (view-only, no edit mode).
 */
(function (global) {
    'use strict';

    var ROAD_DETAILS_URL = '/mapping/api/riyadh-road/';

    function getRoadIdFromQuery() {
        try {
            return new URLSearchParams(global.location.search).get('road');
        } catch (e) {
            return null;
        }
    }

    function getMap() {
        var map = global.geotrakMaplibreMap;
        return map && typeof map.once === 'function' ? map : null;
    }

    async function openRoadFromUrl(roadId) {
        if (!roadId) {
            return;
        }
        var map = getMap();
        if (!map) {
            return;
        }

        var resp = await fetch(
            ROAD_DETAILS_URL + encodeURIComponent(String(roadId)) + '/',
            {
                method: 'GET',
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            }
        );
        var data = await resp.json();
        if (!resp.ok || !data || !data.success || !data.road) {
            if (global.notify && typeof global.notify.tryShow === 'function') {
                global.notify.tryShow(
                    (data && data.message) || 'Could not open that road on the map.',
                    'error'
                );
            }
            return;
        }

        if (data.road.geometry && typeof global.geotrakZoomToRoadGeometry === 'function') {
            global.geotrakZoomToRoadGeometry(data.road.geometry);
        }

        if (typeof global.openRiyadhRoadById !== 'function') {
            return;
        }

        await global.openRiyadhRoadById(roadId, null, { enterEditMode: false });
    }

    function initRoadDeeplink() {
        var roadId = getRoadIdFromQuery();
        if (!roadId) {
            return;
        }

        var map = getMap();
        if (!map) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts += 1;
                map = getMap();
                if (map || attempts > 40) {
                    clearInterval(timer);
                    if (map) {
                        runWhenLoaded(map, roadId);
                    }
                }
            }, 250);
            return;
        }
        runWhenLoaded(map, roadId);
    }

    function runWhenLoaded(map, roadId) {
        if (map.loaded && map.loaded()) {
            openRoadFromUrl(roadId);
            return;
        }
        map.once('load', function () {
            openRoadFromUrl(roadId);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRoadDeeplink);
    } else {
        initRoadDeeplink();
    }
})(typeof window !== 'undefined' ? window : this);
