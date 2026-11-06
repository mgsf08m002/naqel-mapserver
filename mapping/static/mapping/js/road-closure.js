/**
 * Road closure helpers shared by map tiles, edit overlay, side-panel preview, and save.
 * Closed roads: "Road Closure" dashed symbology + no-entry icons (MVT and draft overlay).
 */
(function (global) {
    'use strict';

    var FEATURE_LABEL = 'Road Closure';
    var ICON_IMAGE_ID = 'road-closure-no-entry';
    var ICON_DEFAULT_URL = '/static/mapping/images/road-closure-no-entry.svg';
    var imageLoadPromiseByMap = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var legacyImageLoadPromise = null;

    function parsePayloadValue(raw) {
        return (
            raw === 1 ||
            raw === true ||
            raw === '1' ||
            (typeof raw === 'string' && String(raw).trim() === '1')
        );
    }

    function toTileValue(raw) {
        return parsePayloadValue(raw) ? 1 : 0;
    }

    function isDraftChange(initial, current) {
        return typeof initial === 'boolean' && typeof current === 'boolean' && initial !== current;
    }

    function getIconUrl() {
        var mapEl = typeof document !== 'undefined' ? document.getElementById('map') : null;
        var rel =
            (mapEl && mapEl.getAttribute('data-closure-icon-url')) || ICON_DEFAULT_URL;
        try {
            return new URL(rel, global.location.href).href;
        } catch (e) {
            return rel;
        }
    }

    function ensureMapImage(map) {
        if (!map || typeof map.hasImage !== 'function') {
            return Promise.resolve(false);
        }
        try {
            if (map.hasImage(ICON_IMAGE_ID)) {
                return Promise.resolve(true);
            }
        } catch (eHas) {}

        var existing =
            imageLoadPromiseByMap && imageLoadPromiseByMap.get(map)
                ? imageLoadPromiseByMap.get(map)
                : legacyImageLoadPromise;
        if (existing) {
            return existing;
        }

        var promise = new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                var finish = function () {
                    try {
                        if (!map.hasImage(ICON_IMAGE_ID)) {
                            map.addImage(ICON_IMAGE_ID, img);
                        }
                        resolve(true);
                    } catch (eAdd) {
                        resolve(false);
                    }
                };
                if (typeof img.decode === 'function') {
                    img.decode().then(finish).catch(finish);
                } else {
                    finish();
                }
            };
            img.onerror = function () {
                resolve(false);
            };
            img.src = getIconUrl();
        }).then(function (ok) {
            if (!ok) {
                if (imageLoadPromiseByMap) {
                    imageLoadPromiseByMap.delete(map);
                } else {
                    legacyImageLoadPromise = null;
                }
            }
            return ok;
        });

        if (imageLoadPromiseByMap) {
            imageLoadPromiseByMap.set(map, promise);
        } else {
            legacyImageLoadPromise = promise;
        }
        return promise;
    }

    global.RoadClosure = {
        FEATURE_LABEL: FEATURE_LABEL,
        ICON_IMAGE_ID: ICON_IMAGE_ID,
        parsePayloadValue: parsePayloadValue,
        toTileValue: toTileValue,
        isDraftChange: isDraftChange,
        getIconUrl: getIconUrl,
        ensureMapImage: ensureMapImage,
    };

    global.parseRoadClosurePayloadValue = parsePayloadValue;
})(typeof window !== 'undefined' ? window : this);
