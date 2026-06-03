/** Open a Riyadh road by tile network id (map click + road name search). */
(function (global) {
    'use strict';

    function firstNonEmptyString() {
        for (var i = 0; i < arguments.length; i++) {
            var s = arguments[i];
            if (s == null) {
                continue;
            }
            var t = String(s).trim();
            if (t !== '') {
                return t;
            }
        }
        return '';
    }

    function mergeTilePropsIntoRoad(road, tileProps) {
        if (!road || !tileProps) {
            return road;
        }
        var fd = road.fields_data || {};
        var tName = firstNonEmptyString(tileProps.name, tileProps.Name, tileProps.NAME);
        var tRef = firstNonEmptyString(tileProps.ref, tileProps.Ref, tileProps.REF);
        if (!String(fd.name || '').trim() && tName) {
            fd.name = tName;
        }
        if (!String(fd.ref || '').trim() && tRef) {
            fd.ref = tRef;
        }
        road.fields_data = fd;
        return road;
    }

    function buildTagsFromFields(fieldsData) {
        var skipTags = {
            name: true,
            road_closure: true,
            common_name: true,
            multilingual_names: true,
        };
        var tags = [];
        Object.keys(fieldsData || {}).forEach(function (k) {
            if (skipTags[k]) {
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

    function snapshotOriginalState(roadId, road) {
        try {
            if (!global.riyadhRoadOriginalState) {
                global.riyadhRoadOriginalState = {};
            }
            var fd = road.fields_data || {};
            var originalLabel = road.current_feature_label || road.feature_type || 'Line';
            global.riyadhRoadOriginalState[String(roadId)] = {
                feature_label: originalLabel,
                geometry: road.geometry ? JSON.parse(JSON.stringify(road.geometry)) : null,
                fields_data: fd && typeof fd === 'object' ? JSON.parse(JSON.stringify(fd)) : {},
                tags_data: Array.isArray(road.tags_data) ? JSON.parse(JSON.stringify(road.tags_data)) : [],
            };
            road._original_feature_label = originalLabel;
        } catch (e) {}
    }

    function applyFclassFromLabel(roadId, road) {
        var clientLabel = road.current_feature_label || road.feature_type || '';
        var fd = road.fields_data || {};
        var dbFclass = '';
        if (typeof global.resolveRiyadhFclassForFeatureState === 'function' && clientLabel) {
            dbFclass = global.resolveRiyadhFclassForFeatureState(clientLabel) || '';
        }
        if (!dbFclass && fd.fclass != null) {
            dbFclass = String(fd.fclass).trim();
        }
        if (dbFclass && typeof global.applyRiyadhRoadDbFclassFromDatabase === 'function') {
            global.applyRiyadhRoadDbFclassFromDatabase(roadId, dbFclass);
        }
    }

    function showRoadInEditor(road, options) {
        var opts = options || {};
        if (global.lineDrawingHandler && typeof global.lineDrawingHandler.showRiyadhRoadAsLineFeature === 'function') {
            global.lineDrawingHandler.showRiyadhRoadAsLineFeature(road, opts);
        } else if (typeof global.showRiyadhRoadAsLineFeature === 'function') {
            global.showRiyadhRoadAsLineFeature(road, opts);
        }
    }

    function maybeResumeGeometryEdit() {
        if (
            global.__roadGeometryEditActiveId != null &&
            global.roadGeometryEdit &&
            typeof global.roadGeometryEdit.startFromRiyadhContext === 'function'
        ) {
            setTimeout(function () {
                try {
                    var editScreenEl = document.getElementById('editFeatureScreen');
                    if (editScreenEl && editScreenEl.getAttribute('data-geometry-readonly') === 'true') {
                        return;
                    }
                    global.roadGeometryEdit.startFromRiyadhContext();
                } catch (e) {}
            }, 0);
        }
    }

    /**
     * @param {number} roadId - Network id from vector tiles (`id` column).
     * @param {object} [tileProps] - Optional feature properties from a tile click.
     * @param {{ enterEditMode?: boolean }} [options] - When false, opens sidebar only (e.g. road search).
     * @returns {Promise<{success: boolean, road?: object, message?: string}>}
     */
    async function openRiyadhRoadById(roadId, tileProps, options) {
        var opts = options || {};
        var enterEditMode = opts.enterEditMode !== false;
        var idNum = roadId != null ? parseInt(String(roadId), 10) : NaN;
        if (!idNum || Number.isNaN(idNum)) {
            return { success: false, message: 'Invalid road id.' };
        }

        if (typeof global.setRiyadhRoadSelectedId === 'function') {
            global.setRiyadhRoadSelectedId(idNum);
        }
        if (typeof global.applyMapSidePanelOpen === 'function') {
            global.applyMapSidePanelOpen(true);
        }

        try {
            var resp = await fetch('/mapping/api/riyadh-road/' + idNum + '/', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!resp.ok) {
                return { success: false, message: 'Road not found.' };
            }
            var data = await resp.json();
            if (!data || !data.success || !data.road) {
                return { success: false, message: (data && data.message) || 'Road not found.' };
            }

            var road = mergeTilePropsIntoRoad(data.road, tileProps || null);
            road.tags_data = buildTagsFromFields(road.fields_data);
            snapshotOriginalState(idNum, road);
            applyFclassFromLabel(idNum, road);

            global.selectedRiyadhRoad = road;
            global.approvedLineBeingEdited = road;
            showRoadInEditor(road, { enterEditMode: enterEditMode });
            if (enterEditMode) {
                maybeResumeGeometryEdit();
            }

            return { success: true, road: road };
        } catch (err) {
            return { success: false, message: 'Could not load road details.' };
        }
    }

    global.openRiyadhRoadById = openRiyadhRoadById;
})(typeof window !== 'undefined' ? window : this);
