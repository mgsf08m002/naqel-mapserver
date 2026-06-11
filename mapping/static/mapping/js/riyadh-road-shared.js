/**
 * Shared Riyadh road-network helpers (tags, edit context, network id).
 * Loaded before map-road-select.js and line-drawing.js.
 */
(function (global) {
    'use strict';

    var RIYADH_FIELD_KEYS_OMIT_FROM_TAGS = {
        name: true,
        road_closure: true,
        common_name: true,
        multilingual_names: true,
        // Feature Type is canonical; tag copies caused stale fclass on save.
        fclass: true,
    };

    function buildRiyadhRoadTagsFromFields(fieldsData) {
        var tags = [];
        Object.keys(fieldsData || {}).forEach(function (k) {
            if (RIYADH_FIELD_KEYS_OMIT_FROM_TAGS[k]) {
                return;
            }
            var v = fieldsData[k];
            if (v === undefined || v === null || v === '') {
                return;
            }
            tags.push({ key: k, value: String(v) });
        });
        return tags;
    }

    function normalizeRiyadhRoadTags(road) {
        if (!road || !road.is_riyadh_road) {
            return;
        }
        var fd = road.fields_data && typeof road.fields_data === 'object' ? road.fields_data : {};
        road.fields_data = fd;
        road.tags_data = buildRiyadhRoadTagsFromFields(fd);
    }

    function getRiyadhEditContext() {
        return global.approvedLineBeingEdited || global.selectedRiyadhRoad || null;
    }

    function getRiyadhRoadNetworkId(ctx) {
        if (!ctx) {
            return null;
        }
        return ctx.riyadh_road_id != null ? ctx.riyadh_road_id : ctx.id;
    }

    function isRiyadhSymbologyFclassMapsReady() {
        var inv =
            global.symbologyCatalog &&
            global.symbologyCatalog.riyadh_label_to_fclass;
        return !!(inv && typeof inv === 'object');
    }

    function resolveRiyadhFclassForFeatureState(featureLabel) {
        var labIn = (featureLabel != null ? String(featureLabel) : '').trim();
        var inv =
            global.symbologyCatalog &&
            global.symbologyCatalog.riyadh_label_to_fclass;
        if (labIn && inv) {
            var mapped = inv[labIn.toLowerCase()];
            if (mapped) {
                return mapped;
            }
        }
        return null;
    }

    global.RiyadhRoadShared = {
        RIYADH_FIELD_KEYS_OMIT_FROM_TAGS: RIYADH_FIELD_KEYS_OMIT_FROM_TAGS,
        buildRiyadhRoadTagsFromFields: buildRiyadhRoadTagsFromFields,
        normalizeRiyadhRoadTags: normalizeRiyadhRoadTags,
        getRiyadhEditContext: getRiyadhEditContext,
        getRiyadhRoadNetworkId: getRiyadhRoadNetworkId,
        isRiyadhSymbologyFclassMapsReady: isRiyadhSymbologyFclassMapsReady,
        resolveRiyadhFclassForFeatureState: resolveRiyadhFclassForFeatureState,
    };

    global.resolveRiyadhFclassForFeatureState = resolveRiyadhFclassForFeatureState;
})(typeof window !== 'undefined' ? window : this);
