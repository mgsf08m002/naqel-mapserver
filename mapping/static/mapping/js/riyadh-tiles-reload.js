/**
 * Live Riyadh road-network tile refresh.
 *
 * Flow: API mutates riyadh_roads → returns tiles_version →
 * applyLiveNetworkEditToMap / triggerRiyadhTilesReload → registered map reloaders.
 */
(function () {
    'use strict';

    window.__riyadhTilesVersion = window.__riyadhTilesVersion || null;
    window.__riyadhRoadsTileReloaders = window.__riyadhRoadsTileReloaders || [];

    var LIVE_TILE_RELOAD_DELAY_MS = 400;

    function defaultVersion() {
        return String(Date.now());
    }

    function resolveVersion(version) {
        if (version !== undefined && version !== null) {
            var trimmed = String(version).trim();
            if (trimmed.length) {
                return trimmed;
            }
        }
        return window.__riyadhTilesVersion || defaultVersion();
    }

    window.getRiyadhTilesVersionOrDefault = resolveVersion;

    window.buildRiyadhRoadsTileUrl = function (baseUrl, version) {
        if (!baseUrl) {
            return baseUrl;
        }
        var v = resolveVersion(version);
        var sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
        return baseUrl + sep + 'v=' + encodeURIComponent(String(v));
    };

    window.registerRiyadhRoadsTileReloader = function (fn) {
        if (typeof fn === 'function') {
            window.__riyadhRoadsTileReloaders.push(fn);
        }
    };

    window.triggerRiyadhTilesReload = function (tilesVersion) {
        var resolved = resolveVersion(tilesVersion);
        window.__riyadhTilesVersion = resolved;
        window.__riyadhRoadsTileReloaders.forEach(function (fn) {
            try {
                fn(resolved);
            } catch (e) {}
        });
    };

    /**
     * Reload one MapLibre vector source with a cache-busted tile URL.
     * Returns true when the source existed and reload was attempted.
     */
    window.reloadMaplibreVectorTileSource = function (map, sourceId, baseTileUrl, version) {
        if (!map || !sourceId || !baseTileUrl) {
            return false;
        }
        var bustedUrl = window.buildRiyadhRoadsTileUrl(baseTileUrl, version);
        var src = map.getSource(sourceId);
        if (!src) {
            return false;
        }
        try {
            var cache =
                map.style &&
                map.style.sourceCaches &&
                map.style.sourceCaches[sourceId];
            if (cache && typeof cache.clearTiles === 'function') {
                cache.clearTiles();
            }
        } catch (eCache) {}
        try {
            if (typeof src.setTiles === 'function') {
                src.setTiles([bustedUrl]);
            }
        } catch (eSet) {}
        try {
            if (typeof src.reload === 'function') {
                src.reload();
            }
        } catch (eRel) {}
        try {
            map.triggerRepaint();
        } catch (ePaint) {}
        return true;
    };

    /**
     * Apply symbology hints and reload tiles after a live network mutation response.
     * db_fclass is a short-lived preview until tiles reload; map.js clears overrides on idle.
     *
     * @param {object} data - API JSON (tiles_version, remote_road_id, fclass, deleted_road_id)
     * @param {object} [options] - { editData, reloadDelayMs }
     */
    window.applyLiveNetworkEditToMap = function (data, options) {
        if (!data) {
            return;
        }
        options = options || {};
        var editData = options.editData || null;
        var delay =
            options.reloadDelayMs !== undefined
                ? options.reloadDelayMs
                : LIVE_TILE_RELOAD_DELAY_MS;

        if (
            data.deleted_road_id != null &&
            typeof window.clearRiyadhRoadDbFclassFromDatabase === 'function'
        ) {
            window.clearRiyadhRoadDbFclassFromDatabase(data.deleted_road_id);
        } else if (
            data.remote_road_id != null &&
            typeof window.applyRiyadhRoadDbFclassFromDatabase === 'function'
        ) {
            var fc = data.fclass || '';
            if (
                !fc &&
                editData &&
                typeof window.resolveRiyadhFclassForFeatureState === 'function'
            ) {
                fc =
                    window.resolveRiyadhFclassForFeatureState(
                        editData.current_feature_label || editData.feature_type
                    ) || '';
            }
            window.applyRiyadhRoadDbFclassFromDatabase(
                data.remote_road_id,
                fc || 'unclassified'
            );
        }

        if (data.tiles_version != null && typeof window.triggerRiyadhTilesReload === 'function') {
            if (delay > 0) {
                setTimeout(function () {
                    window.triggerRiyadhTilesReload(data.tiles_version);
                }, delay);
            } else {
                window.triggerRiyadhTilesReload(data.tiles_version);
            }
        }
    };

    if (!window.__riyadhTilesVersion) {
        window.__riyadhTilesVersion = defaultVersion();
    }
})();
