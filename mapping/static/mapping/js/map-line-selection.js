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

    function maplibreSelectionCasingPaintPair(coreLineWidth, lineDasharray) {
        var dash = normalizeDash(lineDasharray);
        var w = Number(coreLineWidth) || 4;
        return {
            outline: {
                'line-color': OUTLINE_COLOR,
                'line-width': casingWidthFromCore(w, OUTLINE_WIDTH_ADD),
                'line-opacity': OUTLINE_OPACITY,
                'line-blur': OUTLINE_BLUR,
                'line-dasharray': dash,
            },
            ring: {
                'line-color': RING_COLOR,
                'line-width': casingWidthFromCore(w, RING_WIDTH_ADD),
                'line-opacity': RING_OPACITY,
                'line-blur': RING_BLUR,
                'line-dasharray': dash,
            },
        };
    }

    function applyGeoJsonCasingFromCoreWidth(map, outlineLayerId, ringLayerId, coreLineWidth, lineDasharray) {
        if (!map) {
            return;
        }
        var pair = maplibreSelectionCasingPaintPair(coreLineWidth, lineDasharray);
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

    function applyRiyadhTileSelectionHighlightFromSymbology(map, style, lineDasharray) {
        if (!map || !style) {
            return;
        }
        var w = Number(style.lineWidth) || 4;
        var c = style.lineColor || '#52525b';
        var dash = normalizeDash(lineDasharray);
        var pair = maplibreSelectionCasingPaintPair(w, dash);
        try {
            if (map.getLayer(RIYADH_CORE_LAYER_ID)) {
                map.setPaintProperty(RIYADH_CORE_LAYER_ID, 'line-color', c);
                map.setPaintProperty(RIYADH_CORE_LAYER_ID, 'line-width', w);
                map.setPaintProperty(RIYADH_CORE_LAYER_ID, 'line-opacity', 1);
                map.setPaintProperty(RIYADH_CORE_LAYER_ID, 'line-dasharray', dash);
            }
            if (map.getLayer(RIYADH_OUTLINE_LAYER_ID)) {
                map.setPaintProperty(RIYADH_OUTLINE_LAYER_ID, 'line-color', pair.outline['line-color']);
                map.setPaintProperty(RIYADH_OUTLINE_LAYER_ID, 'line-width', pair.outline['line-width']);
                map.setPaintProperty(RIYADH_OUTLINE_LAYER_ID, 'line-opacity', pair.outline['line-opacity']);
                map.setPaintProperty(RIYADH_OUTLINE_LAYER_ID, 'line-blur', pair.outline['line-blur']);
                map.setPaintProperty(RIYADH_OUTLINE_LAYER_ID, 'line-dasharray', dash);
            }
            if (map.getLayer(RIYADH_RING_LAYER_ID)) {
                map.setPaintProperty(RIYADH_RING_LAYER_ID, 'line-color', pair.ring['line-color']);
                map.setPaintProperty(RIYADH_RING_LAYER_ID, 'line-width', pair.ring['line-width']);
                map.setPaintProperty(RIYADH_RING_LAYER_ID, 'line-opacity', pair.ring['line-opacity']);
                map.setPaintProperty(RIYADH_RING_LAYER_ID, 'line-blur', pair.ring['line-blur']);
                map.setPaintProperty(RIYADH_RING_LAYER_ID, 'line-dasharray', dash);
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
        applyRiyadhTileSelectionHighlightFromSymbology: applyRiyadhTileSelectionHighlightFromSymbology,
        defaultGeoJsonOutlinePaint: defaultGeoJsonOutlinePaint,
        defaultGeoJsonRingPaint: defaultGeoJsonRingPaint,
    };
})(typeof window !== 'undefined' ? window : this);
