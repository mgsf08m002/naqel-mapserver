/**
 * Road/line selection styling for MapLibre (map, layer review, approval preview).
 * Cyan core + white outer casing + soft cyan ring on variable-width lines.
 */
(function (global) {
    'use strict';

    var CORE_COLOR = '#00E5FF';
    var SOFT_COLOR = '#06B6D4';
    var CASING_COLOR = '#ffffff';

    var RING_WIDTH_ADD = 4;
    var OUTLINE_WIDTH_ADD = 7;

    var OUTLINE_COLOR = CASING_COLOR;
    var RING_COLOR = SOFT_COLOR;

    var OUTLINE_OPACITY = 0.7;
    var RING_OPACITY = 0.85;
    var OUTLINE_BLUR = 0.2;
    var RING_BLUR = 0;

    var GEOJSON_CASING_WIDTH = 10;
    var GEOJSON_CORE_WIDTH = 5;
    var GEOJSON_CASING_OPACITY = 0.7;
    var GEOJSON_CORE_OPACITY = 0.9;

    var SELECTION_LINE_LAYOUT = { 'line-cap': 'round', 'line-join': 'round' };

    var RIYADH_OUTLINE_LAYER_ID = 'riyadh-roads-selected-outline-layer';
    var RIYADH_RING_LAYER_ID = 'riyadh-roads-selected-ring-layer';
    var RIYADH_CORE_LAYER_ID = 'riyadh-roads-selected-layer';

    var OVERLAY_OUTLINE_LAYER_ID = 'selected-road-overlay-outline';
    var OVERLAY_RING_LAYER_ID = 'selected-road-overlay-ring';
    /** Visible selection core on GeoJSON overlay (legacy layer id). */
    var OVERLAY_GRADIENT_LAYER_ID = 'selected-road-overlay-gradient';
    var OVERLAY_LINE_LAYER_ID = 'selected-road-overlay-line';

    function normalizeDash(lineDasharray) {
        return lineDasharray && Array.isArray(lineDasharray) ? lineDasharray : [1, 0];
    }

    function casingWidthFromCore(coreWidth, addPx) {
        var w = Number(coreWidth);
        if (!Number.isFinite(w) || w <= 0) {
            w = GEOJSON_CORE_WIDTH;
        }
        return w + addPx;
    }

    function riyadhTileOutlineWidthExpression(widthExpression) {
        return ['+', widthExpression, OUTLINE_WIDTH_ADD];
    }

    function riyadhTileRingWidthExpression(widthExpression) {
        return ['+', widthExpression, RING_WIDTH_ADD];
    }

    function geoJsonSelectionCasingPaint() {
        return {
            'line-color': OUTLINE_COLOR,
            'line-width': GEOJSON_CASING_WIDTH,
            'line-opacity': GEOJSON_CASING_OPACITY,
            'line-blur': OUTLINE_BLUR,
        };
    }

    function geoJsonSelectionRingPaint() {
        return {
            'line-color': RING_COLOR,
            'line-width': casingWidthFromCore(GEOJSON_CORE_WIDTH, RING_WIDTH_ADD),
            'line-opacity': RING_OPACITY,
            'line-blur': RING_BLUR,
        };
    }

    function isPlaceholderFeatureLabel(label) {
        var normalized = (label || '').trim().toLowerCase();
        return !normalized || normalized === 'line';
    }

    function geoJsonSelectionCorePaint(lineDasharray) {
        var dash = normalizeDash(lineDasharray);
        return {
            'line-color': CORE_COLOR,
            'line-width': GEOJSON_CORE_WIDTH,
            'line-opacity': GEOJSON_CORE_OPACITY,
            'line-dasharray': dash,
        };
    }

    /** Cyan selection core for untyped lines; catalog symbology once a feature type is chosen. */
    function buildEditingCorePaint(style, lineDasharray, featureLabel) {
        var dash = normalizeDash(lineDasharray);
        if (!style || isPlaceholderFeatureLabel(featureLabel)) {
            return geoJsonSelectionCorePaint(dash);
        }
        return {
            'line-color': style.lineColor || '#64748b',
            'line-width': Number(style.lineWidth) || GEOJSON_CORE_WIDTH,
            'line-opacity': GEOJSON_CORE_OPACITY,
            'line-dasharray': dash,
        };
    }

    function geoJsonSelectionFillPaint() {
        return {
            'fill-color': SOFT_COLOR,
            'fill-opacity': 0.16,
            'fill-outline-color': CORE_COLOR,
        };
    }

    function geoJsonSelectionPointPaint() {
        return {
            'circle-radius': 9,
            'circle-color': CORE_COLOR,
            'circle-opacity': 0.92,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': CASING_COLOR,
            'circle-stroke-opacity': 0.85,
        };
    }

    function maplibreSelectionCasingPaintPair(coreLineWidth, lineDasharray, options) {
        options = options || {};
        var dash = normalizeDash(lineDasharray);
        var w = Number(coreLineWidth) || GEOJSON_CORE_WIDTH;
        var casingDash = dash;
        if (options.dashOnlyOnCore && dash.length >= 2 && dash[1] > 0) {
            casingDash = [1, 0];
        }
        return {
            outline: {
                'line-color': OUTLINE_COLOR,
                'line-width': casingWidthFromCore(w, OUTLINE_WIDTH_ADD),
                'line-opacity': OUTLINE_OPACITY,
                'line-blur': OUTLINE_BLUR,
                'line-dasharray': casingDash,
            },
            ring: {
                'line-color': RING_COLOR,
                'line-width': casingWidthFromCore(w, RING_WIDTH_ADD),
                'line-opacity': RING_OPACITY,
                'line-blur': RING_BLUR,
                'line-dasharray': casingDash,
            },
        };
    }

    function applyLinePaint(map, layerId, paint) {
        if (!map || !layerId || !paint) {
            return;
        }
        try {
            if (!map.getLayer(layerId)) {
                return;
            }
            Object.keys(paint).forEach(function (key) {
                map.setPaintProperty(layerId, key, paint[key]);
            });
        } catch (e) {}
    }

    function applyGeoJsonCasingFromCoreWidth(map, outlineLayerId, ringLayerId, coreLineWidth, lineDasharray, options) {
        if (!map) {
            return;
        }
        var pair = maplibreSelectionCasingPaintPair(coreLineWidth, lineDasharray, options);
        applyLinePaint(map, outlineLayerId, pair.outline);
        applyLinePaint(map, ringLayerId, pair.ring);
    }

    function applySelectedCoreLinePaint(map, layerId, widthExpression, lineDasharray) {
        if (!map || !layerId) {
            return;
        }
        var paint = geoJsonSelectionCorePaint(lineDasharray);
        if (widthExpression !== undefined && widthExpression !== null) {
            paint['line-width'] = widthExpression;
        }
        applyLinePaint(map, layerId, paint);
    }

    global.MapLineSelection = {
        CORE_COLOR: CORE_COLOR,
        SOFT_COLOR: SOFT_COLOR,
        CASING_COLOR: CASING_COLOR,
        OUTLINE_COLOR: OUTLINE_COLOR,
        RING_COLOR: RING_COLOR,
        OUTLINE_WIDTH_ADD: OUTLINE_WIDTH_ADD,
        RING_WIDTH_ADD: RING_WIDTH_ADD,
        OUTLINE_OPACITY: OUTLINE_OPACITY,
        RING_OPACITY: RING_OPACITY,
        OUTLINE_BLUR: OUTLINE_BLUR,
        RING_BLUR: RING_BLUR,
        GEOJSON_CASING_WIDTH: GEOJSON_CASING_WIDTH,
        GEOJSON_CORE_WIDTH: GEOJSON_CORE_WIDTH,
        GEOJSON_CORE_OPACITY: GEOJSON_CORE_OPACITY,
        SELECTION_LINE_LAYOUT: SELECTION_LINE_LAYOUT,
        RIYADH_OUTLINE_LAYER_ID: RIYADH_OUTLINE_LAYER_ID,
        RIYADH_RING_LAYER_ID: RIYADH_RING_LAYER_ID,
        RIYADH_CORE_LAYER_ID: RIYADH_CORE_LAYER_ID,
        OVERLAY_OUTLINE_LAYER_ID: OVERLAY_OUTLINE_LAYER_ID,
        OVERLAY_RING_LAYER_ID: OVERLAY_RING_LAYER_ID,
        OVERLAY_GRADIENT_LAYER_ID: OVERLAY_GRADIENT_LAYER_ID,
        OVERLAY_LINE_LAYER_ID: OVERLAY_LINE_LAYER_ID,
        riyadhTileOutlineWidthExpression: riyadhTileOutlineWidthExpression,
        riyadhTileRingWidthExpression: riyadhTileRingWidthExpression,
        casingWidthFromCore: casingWidthFromCore,
        maplibreSelectionCasingPaintPair: maplibreSelectionCasingPaintPair,
        applyGeoJsonCasingFromCoreWidth: applyGeoJsonCasingFromCoreWidth,
        applySelectedCoreLinePaint: applySelectedCoreLinePaint,
        applyLinePaint: applyLinePaint,
        geoJsonSelectionCasingPaint: geoJsonSelectionCasingPaint,
        geoJsonSelectionRingPaint: geoJsonSelectionRingPaint,
        geoJsonSelectionCorePaint: geoJsonSelectionCorePaint,
        buildEditingCorePaint: buildEditingCorePaint,
        isPlaceholderFeatureLabel: isPlaceholderFeatureLabel,
        geoJsonSelectionFillPaint: geoJsonSelectionFillPaint,
        geoJsonSelectionPointPaint: geoJsonSelectionPointPaint,
    };
})(typeof window !== 'undefined' ? window : this);
