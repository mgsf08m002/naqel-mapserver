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

    /** Single sidebar Road Label value from fields_data (name, then legacy common_name). */
    function resolveRoadLabelDisplayValue(fieldsData) {
        if (!fieldsData || typeof fieldsData !== 'object') {
            return '';
        }
        var n = fieldsData.name != null ? String(fieldsData.name).trim() : '';
        var c = fieldsData.common_name != null ? String(fieldsData.common_name).trim() : '';
        return n || c || '';
    }

    function fillRoadLabelInputFromFields(fieldsData) {
        var el = document.getElementById('sidebar-feature-name-input');
        if (!el) {
            return;
        }
        el.value = resolveRoadLabelDisplayValue(fieldsData);
    }

    global.RiyadhRoadShared = {
        RIYADH_FIELD_KEYS_OMIT_FROM_TAGS: RIYADH_FIELD_KEYS_OMIT_FROM_TAGS,
        buildRiyadhRoadTagsFromFields: buildRiyadhRoadTagsFromFields,
        normalizeRiyadhRoadTags: normalizeRiyadhRoadTags,
        getRiyadhEditContext: getRiyadhEditContext,
        getRiyadhRoadNetworkId: getRiyadhRoadNetworkId,
        isRiyadhSymbologyFclassMapsReady: isRiyadhSymbologyFclassMapsReady,
        resolveRiyadhFclassForFeatureState: resolveRiyadhFclassForFeatureState,
        resolveRoadLabelDisplayValue: resolveRoadLabelDisplayValue,
        fillRoadLabelInputFromFields: fillRoadLabelInputFromFields,
    };

    global.resolveRiyadhFclassForFeatureState = resolveRiyadhFclassForFeatureState;
})(typeof window !== 'undefined' ? window : this);
