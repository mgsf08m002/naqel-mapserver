/**
 * Unified road/line selection on the map: dark outline + light ring under the symbology core.
 * Core keeps catalog color, width, and dash; casing adds a larger, high-contrast footprint.
 */
(function (global) {
    'use strict';

    /** Extra width (px) on top of symbology core stroke — tuned for visibility without clutter. */
    var RING_WIDTH_ADD = 4;
    var OUTLINE_WIDTH_ADD = 7;

    var OUTLINE_COLOR = '#0f172a';
    var RING_COLOR = '#ffffff';

    var OUTLINE_OPACITY = 0.93;
    var RING_OPACITY = 1;
    /** Slight blur softens the outer edge on raster basemaps. */
    var OUTLINE_BLUR = 0.45;
    var RING_BLUR = 0;

    var RIYADH_OUTLINE_LAYER_ID = 'riyadh-roads-selected-outline-layer';
    var RIYADH_RING_LAYER_ID = 'riyadh-roads-selected-ring-layer';
    var RIYADH_CORE_LAYER_ID = 'riyadh-roads-selected-layer';

    var OVERLAY_OUTLINE_LAYER_ID = 'selected-road-overlay-outline';
    var OVERLAY_RING_LAYER_ID = 'selected-road-overlay-ring';
    var OVERLAY_GRADIENT_LAYER_ID = 'selected-road-overlay-gradient';
    var OVERLAY_LINE_LAYER_ID = 'selected-road-overlay-line';

    function normalizeDash(lineDasharray) {
        return lineDasharray && Array.isArray(lineDasharray) ? lineDasharray : [1, 0];
    }

    function casingWidthFromCore(coreWidth, addPx) {
        var w = Number(coreWidth);
        if (!Number.isFinite(w) || w <= 0) {
            w = 3;
        }
        return w + addPx;
    }

    function riyadhTileOutlineWidthExpression(widthExpression) {
        return ['+', widthExpression, OUTLINE_WIDTH_ADD];
    }

    function riyadhTileRingWidthExpression(widthExpression) {
        return ['+', widthExpression, RING_WIDTH_ADD];
    }

    function defaultGeoJsonOutlinePaint() {
        return {
            'line-color': OUTLINE_COLOR,
            'line-width': casingWidthFromCore(4, OUTLINE_WIDTH_ADD),
            'line-opacity': OUTLINE_OPACITY,
            'line-blur': OUTLINE_BLUR,
        };
    }

    function defaultGeoJsonRingPaint() {
        return {
            'line-color': RING_COLOR,
            'line-width': casingWidthFromCore(4, RING_WIDTH_ADD),
            'line-opacity': RING_OPACITY,
            'line-blur': RING_BLUR,
        };
    }

    /**
     * When dashOnlyOnCore is true, outline/ring use a solid stroke ([1, 0]) while the core stays dashed.
     * Applying the same dasharray to all three layers mis-phases strokes at different widths (moiré, zebra).
     */
    function maplibreSelectionCasingPaintPair(coreLineWidth, lineDasharray, options) {
        options = options || {};
        var dash = normalizeDash(lineDasharray);
        var w = Number(coreLineWidth) || 4;
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

    function applyGeoJsonCasingFromCoreWidth(map, outlineLayerId, ringLayerId, coreLineWidth, lineDasharray, options) {
        if (!map) {
            return;
        }
        var pair = maplibreSelectionCasingPaintPair(coreLineWidth, lineDasharray, options);
        try {
            if (map.getLayer(outlineLayerId)) {
                map.setPaintProperty(outlineLayerId, 'line-color', pair.outline['line-color']);
                map.setPaintProperty(outlineLayerId, 'line-width', pair.outline['line-width']);
                map.setPaintProperty(outlineLayerId, 'line-opacity', pair.outline['line-opacity']);
                map.setPaintProperty(outlineLayerId, 'line-blur', pair.outline['line-blur']);
                map.setPaintProperty(outlineLayerId, 'line-dasharray', pair.outline['line-dasharray']);
            }
            if (map.getLayer(ringLayerId)) {
                map.setPaintProperty(ringLayerId, 'line-color', pair.ring['line-color']);
                map.setPaintProperty(ringLayerId, 'line-width', pair.ring['line-width']);
                map.setPaintProperty(ringLayerId, 'line-opacity', pair.ring['line-opacity']);
                map.setPaintProperty(ringLayerId, 'line-blur', pair.ring['line-blur']);
                map.setPaintProperty(ringLayerId, 'line-dasharray', pair.ring['line-dasharray']);
            }
        } catch (e) {}
    }

    global.MapLineSelection = {
        OUTLINE_COLOR: OUTLINE_COLOR,
        RING_COLOR: RING_COLOR,
        OUTLINE_WIDTH_ADD: OUTLINE_WIDTH_ADD,
        RING_WIDTH_ADD: RING_WIDTH_ADD,
        OUTLINE_OPACITY: OUTLINE_OPACITY,
        RING_OPACITY: RING_OPACITY,
        OUTLINE_BLUR: OUTLINE_BLUR,
        RING_BLUR: RING_BLUR,

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
        defaultGeoJsonOutlinePaint: defaultGeoJsonOutlinePaint,
        defaultGeoJsonRingPaint: defaultGeoJsonRingPaint,
    };
})(typeof window !== 'undefined' ? window : this);
