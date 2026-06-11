(function () {
    'use strict';
    window.__riyadhTilesVersion = window.__riyadhTilesVersion || null;
    window.__riyadhRoadsTileReloaders = window.__riyadhRoadsTileReloaders || [];

    var TILE_RELOAD_COALESCE_MS = 60;
    var TILE_RELOAD_AFTER_OVERLAY_MS = 280;
    var tileReloadCoalesceTimer = null;
    var tileReloadCoalesceVersion = null;

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



    function scheduleRepaint() {

        var repaint = function () {

            if (typeof window.reapplyRiyadhRoadLayerPaintStates === 'function') {

                window.reapplyRiyadhRoadLayerPaintStates();

            }

        };

        if (typeof requestAnimationFrame === 'function') {

            requestAnimationFrame(repaint);

        } else {

            repaint();

        }

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



    function flushRiyadhTilesReload() {

        tileReloadCoalesceTimer = null;

        var resolved = resolveVersion(tileReloadCoalesceVersion);

        tileReloadCoalesceVersion = null;

        window.__riyadhTilesVersion = resolved;

        window.__riyadhRoadsTileReloaders.forEach(function (fn) {

            try {

                fn(resolved);

            } catch (e) {}

        });

    }



    window.triggerRiyadhTilesReload = function (tilesVersion) {

        tileReloadCoalesceVersion = resolveVersion(tilesVersion);

        if (tileReloadCoalesceTimer) {

            clearTimeout(tileReloadCoalesceTimer);

        }

        tileReloadCoalesceTimer = setTimeout(flushRiyadhTilesReload, TILE_RELOAD_COALESCE_MS);

    };



    /** True when MVT tiles must refresh (geometry edit or delete). */

    window.riyadhMutationNeedsTileReload = function (data) {

        if (!data) {

            return false;

        }

        if (data.deleted_road_id != null) {

            return true;

        }

        return !!data.geometry_changed;

    };



    function resolveMutationGeometry(editData) {

        if (editData && editData.geometry) {

            return editData.geometry;

        }

        var ctx = window.approvedLineBeingEdited || window.selectedRiyadhRoad || null;

        return ctx && ctx.geometry ? ctx.geometry : null;

    }



    function resolveMutationFeatureLabel(editData) {

        if (editData) {

            var fromEdit = editData.current_feature_label || editData.feature_type;

            if (fromEdit) {

                return fromEdit;

            }

        }

        var ctx = window.approvedLineBeingEdited || window.selectedRiyadhRoad || null;

        return ctx ? ctx.current_feature_label || ctx.feature_type || '' : '';

    }



    /** GeoJSON overlay while MVT tiles refresh after a geometry mutation. */

    window.beginRiyadhPostSaveOverlayBridge = function (roadId, featureLabel, geometry) {

        if (roadId == null || roadId === '') {

            return;

        }

        window.__riyadhPostSaveOverlayActive = true;

        window.__roadGeometryEditActiveId = roadId;



        if (geometry) {

            [window.approvedLineBeingEdited, window.selectedRiyadhRoad].forEach(function (r) {

                if (r && r.is_riyadh_road) {

                    r.geometry = geometry;

                }

            });

            if (typeof window.setSelectedOverlayGeometry === 'function') {

                window.setSelectedOverlayGeometry(geometry);

            }

        }



        if (

            window.lineDrawingHandler &&

            typeof window.lineDrawingHandler.updateRiyadhRoadVisualization === 'function'

        ) {

            window.lineDrawingHandler.updateRiyadhRoadVisualization(

                roadId,

                featureLabel != null ? String(featureLabel) : '',

                geometry || null

            );

        }

    };



    window.endRiyadhPostSaveOverlayBridge = function () {

        window.__riyadhPostSaveOverlayActive = false;

        try {

            window.__roadGeometryEditActiveId = null;

        } catch (e) {}

        if (typeof window.hideSelectedOverlayPaint === 'function') {

            try {

                window.hideSelectedOverlayPaint();

            } catch (eHide) {}

        }

        if (typeof window.setSelectedOverlayGeometry === 'function') {

            try {

                window.setSelectedOverlayGeometry(null);

            } catch (eGeom) {}

        }

    };



    /**

     * Soft MVT refresh: keep current tiles visible until new ones load.

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

            if (typeof src.setTiles === 'function') {

                src.setTiles([bustedUrl]);

            }

        } catch (eSet) {}

        return true;

    };



    window.applyLiveNetworkEditToMap = function (data, options) {

        if (!data) {

            return;

        }

        options = options || {};

        var editData = options.editData || null;

        var needsReload = window.riyadhMutationNeedsTileReload(data);



        if (data.deleted_road_id != null) {

            if (typeof window.clearRiyadhRoadDbFclassFromDatabase === 'function') {

                window.clearRiyadhRoadDbFclassFromDatabase(data.deleted_road_id);

            }

            if (typeof window.clearRiyadhRoadDbClosureFromDatabase === 'function') {

                window.clearRiyadhRoadDbClosureFromDatabase(data.deleted_road_id);

            }

        } else if (data.remote_road_id != null) {

            if (typeof window.applyRiyadhRoadDbFclassFromDatabase === 'function') {

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

                if (fc || editData) {

                    window.applyRiyadhRoadDbFclassFromDatabase(

                        data.remote_road_id,

                        fc || 'unclassified'

                    );

                }

            }

            if (

                data.closure_applied &&

                typeof window.applyRiyadhRoadDbClosureFromDatabase === 'function'

            ) {

                var closureVal =

                    data.road_closure !== undefined && data.road_closure !== null

                        ? data.road_closure

                        : editData && editData.road_closure !== undefined

                          ? editData.road_closure

                          : 0;

                window.applyRiyadhRoadDbClosureFromDatabase(

                    data.remote_road_id,

                    closureVal

                );

            }

        }



        if (data.tiles_version != null) {

            window.__riyadhTilesVersion = resolveVersion(data.tiles_version);

        }



        if (!needsReload || data.tiles_version == null) {

            return;

        }



        var delay = window.__riyadhPostSaveOverlayActive ? TILE_RELOAD_AFTER_OVERLAY_MS : 0;

        var scheduleReload = function () {

            window.triggerRiyadhTilesReload(data.tiles_version);

        };

        if (delay > 0) {

            setTimeout(scheduleReload, delay);

        } else if (typeof requestAnimationFrame === 'function') {

            requestAnimationFrame(scheduleReload);

        } else {

            scheduleReload();

        }

    };



    /**

     * Apply a save/approve API response: overlay bridge (geometry) then live map update.

     * @returns {{ needsTileReload: boolean, payload: object }}

     */

    window.applyRiyadhNetworkMutationResponse = function (serverData, editData) {

        var payload = Object.assign({}, serverData || {});

        if (payload.remote_road_id == null && editData && editData.riyadh_road_id != null) {

            payload.remote_road_id = editData.riyadh_road_id;

        }



        var needsTileReload = window.riyadhMutationNeedsTileReload(payload);

        var networkRoadId = payload.remote_road_id;

        var geometry = resolveMutationGeometry(editData);

        var featureLabel = resolveMutationFeatureLabel(editData);



        if (needsTileReload && networkRoadId != null && geometry) {

            window.beginRiyadhPostSaveOverlayBridge(networkRoadId, featureLabel, geometry);

        }



        window.applyLiveNetworkEditToMap(payload, { editData: editData || null });

        return { needsTileReload: needsTileReload, payload: payload };

    };



    /** Batch map paint during save so side effects do not repaint separately. */

    window.runRiyadhRoadSaveMapTransition = function (fn) {

        window.__riyadhRoadSuppressMapPaint = true;

        try {

            if (typeof fn === 'function') {

                fn();

            }

        } finally {

            window.__riyadhRoadSuppressMapPaint = false;

            scheduleRepaint();

        }

    };



    if (!window.__riyadhTilesVersion) {

        window.__riyadhTilesVersion = defaultVersion();

    }

})();


