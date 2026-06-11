/**
 * Road closure helpers shared by map tiles, edit overlay, and save flows.
 * Closed roads: red dashed line (symbology "Road Closure") + no-entry icons on MVT.
 */
(function (global) {
    'use strict';

    var FEATURE_LABEL = 'Road Closure';

    function parsePayloadValue(raw) {
        return (
            raw === 1 ||
            raw === true ||
            raw === '1' ||
            (typeof raw === 'string' && String(raw).trim() === '1')
        );
    }

    function isDraftChange(initial, current) {
        return typeof initial === 'boolean' && typeof current === 'boolean' && initial !== current;
    }

    function corePaintFromStyle(mls, style, lineDasharray) {
        if (!mls || !style) {
            return null;
        }
        return mls.buildEditingCorePaint(style, lineDasharray, FEATURE_LABEL);
    }

    global.RoadClosure = {
        FEATURE_LABEL: FEATURE_LABEL,
        parsePayloadValue: parsePayloadValue,
        isDraftChange: isDraftChange,
        corePaintFromStyle: corePaintFromStyle,
    };

    global.parseRoadClosurePayloadValue = parsePayloadValue;
})(typeof window !== 'undefined' ? window : this);
