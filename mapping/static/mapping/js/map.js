// KSA Map Editing Module
function isUserAuthenticated() {
    try {
        if (typeof IS_AUTHENTICATED !== 'undefined') return !!IS_AUTHENTICATED;
    } catch (e) {}
    const mapElement = document.getElementById('map');
    if (!mapElement) return false;
    return mapElement.getAttribute('data-is-authenticated') !== 'false';
}

const IS_AUTHENTICATED = isUserAuthenticated();

/**
 * Single shared fetch for `/symbology/api/catalog/` so map layers and line-drawing
 * (dropdowns, MVT db_fclass, GeoJSON overlay) do not race duplicate requests.
 * Retries are allowed after failure: the in-flight promise is cleared on error.
 */
window.__naqelLoadSymbologyCatalog = function __naqelLoadSymbologyCatalog() {
    if (window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
        return Promise.resolve(window.symbologyCatalog);
    }
    if (!window.__naqelSymbologyCatalogPromise) {
        window.__naqelSymbologyCatalogPromise = fetch('/symbology/api/catalog/', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })
            .then(function (resp) {
                if (!resp.ok) {
                    throw new Error('Failed to load symbology catalog');
                }
                return resp.json();
            })
            .then(function (catalog) {
                if (!catalog || typeof catalog !== 'object' || !catalog.styles_by_label) {
                    throw new Error('Invalid symbology catalog payload');
                }
                window.symbologyCatalog = catalog;
                window.__naqelSymbologyCatalogLastError = null;
                return catalog;
            })
            .catch(function (err) {
                window.__naqelSymbologyCatalogLastError = err;
                window.__naqelSymbologyCatalogPromise = undefined;
                throw err;
            });
    }
    return window.__naqelSymbologyCatalogPromise;
};

function getMaptilerApiKey() {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        return null;
    }

    const value = mapElement.getAttribute('data-maptiler-api-key');
    if (!value || typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}

function getRiyadhRoadsTileUrl() {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        return null;
    }

    const value = mapElement.getAttribute('data-riyadh-roads-tile-url');
    if (!value || typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
        return null;
    }

    return trimmed;
}

const MAPTILER_API_KEY = getMaptilerApiKey();
const HAS_MAPTILER = !!MAPTILER_API_KEY;
const RIYADH_ROADS_TILE_URL = getRiyadhRoadsTileUrl();
const HAS_RIYADH_ROADS_TILES = !!RIYADH_ROADS_TILE_URL;
const MAP_GLYPHS_URL = HAS_MAPTILER
    ? `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${MAPTILER_API_KEY}`
    : 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';
/** Neutral basemap color for the Riyadh MVT public layer (all users). */
const RIYADH_PUBLIC_ROAD_LINE_COLOR = '#686d75';
const RTL_TEXT_PLUGIN_URL = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js';

function ensureRtlTextPluginLoaded() {
    try {
        if (
            typeof maplibregl !== 'undefined' &&
            maplibregl &&
            typeof maplibregl.setRTLTextPlugin === 'function'
        ) {
            // Required for proper Arabic shaping (joining, bidi order).
            maplibregl.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, null, true);
        }
    } catch (e) {}
}

ensureRtlTextPluginLoaded();

const BASEMAP_DEFINITIONS = (() => {
    const definitions = [
        {
            id: 'esri-satellite',
            label: 'Satellite',
            sourceId: 'basemap-esri-satellite-source',
            layerId: 'basemap-esri-satellite-layer',
            tileUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Source: Esri, Maxar, Earthstar Geographics',
            requiresMaptiler: false,
        },
    ];

    if (HAS_MAPTILER) {
        const maptilerBaseUrl = 'https://api.maptiler.com/maps';

        definitions.push(
            {
                id: 'maptiler-streets',
                label: 'Streets',
                sourceId: 'basemap-maptiler-streets-source',
                layerId: 'basemap-maptiler-streets-layer',
                tileUrl: `${maptilerBaseUrl}/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`,
                attribution: '© MapTiler © OpenStreetMap contributors',
                requiresMaptiler: true,
            },
            {
                id: 'maptiler-outdoor',
                label: 'Outdoor',
                sourceId: 'basemap-maptiler-outdoor-source',
                layerId: 'basemap-maptiler-outdoor-layer',
                tileUrl: `${maptilerBaseUrl}/outdoor-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`,
                attribution: '© MapTiler © OpenStreetMap contributors',
                requiresMaptiler: true,
            },
            {
                id: 'maptiler-dark',
                label: 'Dark',
                sourceId: 'basemap-maptiler-dark-source',
                layerId: 'basemap-maptiler-dark-layer',
                tileUrl: `${maptilerBaseUrl}/darkmatter/256/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`,
                attribution: '© MapTiler © OpenStreetMap contributors',
                requiresMaptiler: true,
            }
        );
    }

    return definitions;
})();

let currentBasemapId = HAS_MAPTILER ? 'maptiler-streets' : 'esri-satellite';
const bounds = [
    [45.475, 23.981], // Northeast
    [48.733, 25.664], // Southwest
];

const baseSources = {};
const baseLayers = [];

BASEMAP_DEFINITIONS.forEach((def) => {
    baseSources[def.sourceId] = {
        type: 'raster',
        tiles: [def.tileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution: def.attribution,
    };

    baseLayers.push({
        id: def.layerId,
        type: 'raster',
        source: def.sourceId,
        layout: {
            visibility: def.id === currentBasemapId ? 'visible' : 'none',
        },
    });
});

const map = new maplibregl.Map({
    container: 'map',
    center: [46.727866, 24.723580],
    zoom: 9.5,
    maxZoom: 19,
    maxBounds: bounds,
    style: {
        version: 8,
        glyphs: MAP_GLYPHS_URL,
        sources: baseSources,
        layers: baseLayers,
    },
});

/** MapLibre instance for other scripts. Do not use `window.map` — the #map div id shadows it. */
window.naqelMaplibreMap = map;

function setBasemapVisibility(targetId) {
    if (!map || !targetId) return;

    BASEMAP_DEFINITIONS.forEach((def) => {
        const visibility = def.id === targetId ? 'visible' : 'none';
        if (map.getLayer(def.layerId)) {
            map.setLayoutProperty(def.layerId, 'visibility', visibility);
        }
    });

    currentBasemapId = targetId;
}

const BASEMAP_SELECTED_CLASSES = ['ring-2', 'ring-blue-500', 'shadow-lg', 'border-blue-500'];
const BASEMAP_UNSELECTED_CLASSES = ['border-transparent', 'opacity-80'];

function syncBasemapGallerySelection(options, selectedId) {
    options.forEach((opt) => {
        const id = opt.getAttribute('data-basemap-id');
        const isSelected = id === selectedId;

        opt.classList.remove(...BASEMAP_SELECTED_CLASSES, ...BASEMAP_UNSELECTED_CLASSES);
        if (isSelected) {
            opt.classList.add(...BASEMAP_SELECTED_CLASSES);
        } else {
            opt.classList.add(...BASEMAP_UNSELECTED_CLASSES);
        }
    });
}

function initBasemapGallery() {
    const galleryElement = document.getElementById('basemapGallery');
    const toggleButton = document.getElementById('basemapGalleryToggle');

    if (!galleryElement) return;

    const options = galleryElement.querySelectorAll('[data-basemap-id]');
    if (!options.length) return;

    const availableBasemapIds = new Set(BASEMAP_DEFINITIONS.map((def) => def.id));

    options.forEach((option) => {
        const basemapId = option.getAttribute('data-basemap-id');

        if (!basemapId || !availableBasemapIds.has(basemapId)) {
            option.setAttribute('disabled', 'true');
            option.classList.add('opacity-50', 'cursor-not-allowed');
            return;
        }

        option.addEventListener('click', () => {
            if (basemapId === currentBasemapId) return;

            setBasemapVisibility(basemapId);
            syncBasemapGallerySelection(options, basemapId);
        });
    });

    syncBasemapGallerySelection(options, currentBasemapId);

    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            const isHidden = galleryElement.classList.toggle('hidden');
            toggleButton.setAttribute('aria-expanded', String(!isHidden));
        });
    }
}

map.addControl(new maplibregl.NavigationControl({
    visualizePitch: true,
    visualizeRoll: true,
    showZoom: true,
    showCompass: true
}));

map.addControl(
    new maplibregl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true
    })
);

const fullscreenControl = new maplibregl.FullscreenControl();
map.addControl(fullscreenControl, 'top-right');

const isEditingEnabled = !!document.getElementById('editSidePanel');

let drawInstance = null;

if (isEditingEnabled) {
    const draw = new MaplibreTerradrawControl.MaplibreTerradrawControl({
        modes: [
            'point',
            'linestring',
            'polygon',
            'rectangle',
            'circle',
            'freehand',
            'angled-rectangle',
            'sensor',
            'sector',
            'select',
            'delete-selection',
            'delete',
            'download'
        ],
        open: true
    });
    map.addControl(draw, 'top-left');
    window.draw = draw;

    drawInstance = draw.getTerraDrawInstance();
}
let selectedFeature = null;
window.currentlySelectedItem = null;
window.currentlySelectedItemType = null; // 'terradraw-line'

if (drawInstance) {
    drawInstance.on('select', (id) => {
        const snapshot = drawInstance.getSnapshot();
        const features = snapshot?.find((feature) => feature.id === id);
        selectedFeature = JSON.stringify(features);
        window.currentlySelectedItem = id;
        window.currentlySelectedItemType = 'terradraw-line';

        window.selectedRiyadhRoad = null;
    });
    
    drawInstance.on('deselect', () => {
        if (window.currentlySelectedItemType === 'terradraw-line') {
            window.currentlySelectedItem = null;
            window.currentlySelectedItemType = null;
        }
    });
    
    drawInstance.on('finish', (id) => {
        window.selectedRiyadhRoad = null;
    });
}

const COORDINATE_DECIMALS = 6;

function formatCoordinate(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    return value.toFixed(COORDINATE_DECIMALS);
}

function updateCoordinateDisplay(lngLat) {
    const el = document.getElementById('coordinatesDisplay');
    if (!el || !lngLat) {
        return;
    }

    const lng = formatCoordinate(lngLat.lng);
    const lat = formatCoordinate(lngLat.lat);
    if (!lng || !lat) {
        return;
    }

    el.textContent = `Lon: ${lng}, Lat: ${lat}`;
    el.classList.remove('hidden');
}

map.on('mousemove', (e) => {
    updateCoordinateDisplay(e.lngLat);
});


map.on('load', () => {
    setBasemapVisibility(currentBasemapId);
    try {
            const SOURCE_ID = 'riyadh-roads';
            const PUBLIC_LAYER_ID = 'riyadh-roads-public-layer';
            const STYLED_LAYER_ID = 'riyadh-roads-layer';
            const HOVER_LAYER_ID = 'riyadh-roads-hover-layer';
            const LABEL_LAYER_ID_EN = 'riyadh-roads-label-en-layer';
            const LABEL_LAYER_ID_AR = 'riyadh-roads-label-ar-layer';
            const LABELS_SOURCE_ID = 'riyadh-roads-labels-source';
            const MLS = window.MapLineSelection;
            if (!MLS) {
                console.error('map.js requires mapping/js/map-line-selection.js before map.js');
                return;
            }
            const OUTLINE_LAYER_ID = MLS.RIYADH_OUTLINE_LAYER_ID;
            const RING_LAYER_ID = MLS.RIYADH_RING_LAYER_ID;
            const SELECTED_LAYER_ID = MLS.RIYADH_CORE_LAYER_ID;
            const SOURCE_LAYER = 'riyadh_roads';
            const HOVER_NONE_ID = -999999;
            const ROAD_CLOSURE_ICON_LAYER_ID = 'riyadh-roads-closure-icons';
            const CLOSURE_ICON_IMAGE_ID = 'road-closure-no-entry';
            /** MVT `road_closure === 1` match; drives styled symbology, icons, and public-layer hide. */
            let riyadhRoadClosureExpr = null;

            function loadSvgAsHtmlImage(url) {
                return new Promise(function(resolve, reject) {
                    const img = new Image();
                    img.onload = function() {
                        resolve(img);
                    };
                    img.onerror = function() {
                        reject(new Error('Failed to load ' + url));
                    };
                    img.src = url;
                });
            }

            function riyadhClosureIconOpacityWhenBasemapRoadHidden(roadIdToHide, hidden, isClosedExpr) {
                if (!isClosedExpr) {
                    return ['literal', 0];
                }
                if (!hidden || roadIdToHide === null || roadIdToHide === undefined) {
                    return ['case', isClosedExpr, 1, 0];
                }
                const n = parseRiyadhRoadIdNum(roadIdToHide);
                if (Number.isNaN(n)) {
                    return ['case', isClosedExpr, 1, 0];
                }
                return [
                    'case',
                    buildRiyadhRoadIdEqualsExpression(n),
                    0,
                    ['case', isClosedExpr, 1, 0],
                ];
            }

            function ensureRoadClosureIconLayer(isClosedExpr) {
                if (!HAS_RIYADH_ROADS_TILES || !map.getSource(SOURCE_ID) || !map.getLayer(STYLED_LAYER_ID)) {
                    return;
                }
                if (map.getLayer(ROAD_CLOSURE_ICON_LAYER_ID)) {
                    try {
                        reapplyRiyadhRoadLayerPaintStates();
                    } catch (eOp) {}
                    return;
                }
                const mapEl = document.getElementById('map');
                const rel =
                    (mapEl && mapEl.getAttribute('data-closure-icon-url')) ||
                    '/static/mapping/images/road-closure-no-entry.svg';
                const url = new URL(rel, window.location.href).href;
                loadSvgAsHtmlImage(url)
                    .then(function(image) {
                        if (image && typeof image.decode === 'function') {
                            return image.decode().then(function() {
                                return image;
                            }).catch(function() {
                                return image;
                            });
                        }
                        return image;
                    })
                    .catch(function() {
                        return null;
                    })
                    .then(function(image) {
                        if (!image || !map.getStyle()) {
                            return;
                        }
                        if (map.getLayer(ROAD_CLOSURE_ICON_LAYER_ID)) {
                            return;
                        }
                        try {
                            if (!map.hasImage(CLOSURE_ICON_IMAGE_ID)) {
                                map.addImage(CLOSURE_ICON_IMAGE_ID, image);
                            }
                        } catch (eImg) {
                            return;
                        }
                        if (!map.getSource(SOURCE_ID) || map.getLayer(ROAD_CLOSURE_ICON_LAYER_ID)) {
                            return;
                        }
                        let vis = 'visible';
                        try {
                            if (
                                map.getLayer(STYLED_LAYER_ID) &&
                                map.getLayoutProperty(STYLED_LAYER_ID, 'visibility') === 'none'
                            ) {
                                vis = 'none';
                            }
                        } catch (eVis) {}
                        map.addLayer({
                            id: ROAD_CLOSURE_ICON_LAYER_ID,
                            type: 'symbol',
                            source: SOURCE_ID,
                            'source-layer': SOURCE_LAYER,
                            layout: {
                                'icon-image': CLOSURE_ICON_IMAGE_ID,
                                'icon-size': 0.22,
                                'symbol-placement': 'line',
                                'symbol-spacing': 96,
                                'icon-rotation-alignment': 'map',
                                'icon-pitch-alignment': 'map',
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true,
                                visibility: vis,
                            },
                            paint: {
                                'icon-opacity': ['case', isClosedExpr, 1, 0],
                            },
                        });
                        try {
                            reapplyRiyadhRoadLayerPaintStates();
                        } catch (eRe) {}
                    });
            }

            // Symbology: coalesce(feature-state db_*, tile properties) for instant live edits.
            window.__riyadhRoadDbFclassById = window.__riyadhRoadDbFclassById || {};
            window.__riyadhRoadDbClosureById = window.__riyadhRoadDbClosureById || {};

            function normalizeRiyadhDbFclassForTiles(raw) {
                const s = String(raw || '').trim().toLowerCase();
                return s.length ? s : null;
            }

            window.applyRiyadhRoadDbFclassFromDatabase = function(roadId, dbFclassRaw) {
                const fc = normalizeRiyadhDbFclassForTiles(dbFclassRaw);
                const idNum = roadId != null ? parseInt(String(roadId), 10) : NaN;
                if (!fc || Number.isNaN(idNum)) {
                    return;
                }
                window.__riyadhRoadDbFclassById[String(idNum)] = fc;
                try {
                    if (!map.getSource(SOURCE_ID)) {
                        return;
                    }
                    map.setFeatureState(
                        { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: idNum },
                        { db_fclass: fc }
                    );
                } catch (e) {}
            };

            window.clearRiyadhRoadDbFclassFromDatabase = function(roadId) {
                const idNum = roadId != null ? parseInt(String(roadId), 10) : NaN;
                if (Number.isNaN(idNum)) {
                    return;
                }
                const k = String(idNum);
                if (window.__riyadhRoadDbFclassById) {
                    delete window.__riyadhRoadDbFclassById[k];
                }
                try {
                    if (!map.getSource(SOURCE_ID)) {
                        return;
                    }
                    map.removeFeatureState(
                        { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: idNum },
                        'db_fclass'
                    );
                } catch (eClr) {}
            };

            function normalizeRiyadhDbClosureForTiles(raw) {
                if (raw === 1 || raw === '1' || raw === true) {
                    return 1;
                }
                return 0;
            }

            window.applyRiyadhRoadDbClosureFromDatabase = function(roadId, closureRaw) {
                const idNum = roadId != null ? parseInt(String(roadId), 10) : NaN;
                if (Number.isNaN(idNum)) {
                    return;
                }
                const v = normalizeRiyadhDbClosureForTiles(closureRaw);
                window.__riyadhRoadDbClosureById[String(idNum)] = v;
                try {
                    if (!map.getSource(SOURCE_ID)) {
                        return;
                    }
                    map.setFeatureState(
                        { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: idNum },
                        { db_road_closure: v }
                    );
                } catch (eCls) {}
            };

            window.clearRiyadhRoadDbClosureFromDatabase = function(roadId) {
                const idNum = roadId != null ? parseInt(String(roadId), 10) : NaN;
                if (Number.isNaN(idNum)) {
                    return;
                }
                const k = String(idNum);
                if (window.__riyadhRoadDbClosureById) {
                    delete window.__riyadhRoadDbClosureById[k];
                }
                try {
                    if (!map.getSource(SOURCE_ID)) {
                        return;
                    }
                    map.removeFeatureState(
                        { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: idNum },
                        'db_road_closure'
                    );
                } catch (eClrCls) {}
            };

            function finishRiyadhRoadTilesReload() {
                window.__riyadhRoadTilesReloading = false;
                try {
                    if (typeof window.endRiyadhPostSaveOverlayBridge === 'function') {
                        window.endRiyadhPostSaveOverlayBridge();
                    }
                    reapplyRiyadhRoadLiveFeatureStates();
                    syncPublicRoadBasemapVisibility();
                } catch (eFinish) {}
            }

            function waitForRiyadhSourceSettled(callback) {
                let settleTimer = null;
                let finished = false;
                const done = function() {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    try {
                        map.off('sourcedata', onData);
                    } catch (eOff) {}
                    if (settleTimer) {
                        clearTimeout(settleTimer);
                        settleTimer = null;
                    }
                    callback();
                };
                const onData = function(e) {
                    if (e.sourceId !== SOURCE_ID) {
                        return;
                    }
                    if (settleTimer) {
                        clearTimeout(settleTimer);
                    }
                    settleTimer = setTimeout(done, 120);
                };
                map.on('sourcedata', onData);
                setTimeout(done, 900);
            }

            /** Authenticated maps use styled symbology only; hide duplicate gray public underlay. */
            function syncPublicRoadBasemapVisibility() {
                if (!map.getLayer(PUBLIC_LAYER_ID)) {
                    return;
                }
                const hidePublic = !!map.getLayer(STYLED_LAYER_ID);
                try {
                    map.setLayoutProperty(
                        PUBLIC_LAYER_ID,
                        'visibility',
                        hidePublic ? 'none' : 'visible'
                    );
                } catch (eVis) {}
            }

            function reapplyRiyadhRoadLiveFeatureStates() {
                const fclassMap = window.__riyadhRoadDbFclassById || {};
                const closureMap = window.__riyadhRoadDbClosureById || {};
                const ids = {};
                Object.keys(fclassMap).forEach(function(k) {
                    ids[k] = true;
                });
                Object.keys(closureMap).forEach(function(k) {
                    ids[k] = true;
                });
                const idKeys = Object.keys(ids);
                if (idKeys.length) {
                    try {
                        if (map.getSource(SOURCE_ID)) {
                            idKeys.forEach(function(k) {
                                const idNum = parseInt(k, 10);
                                if (Number.isNaN(idNum)) {
                                    return;
                                }
                                const state = {};
                                if (fclassMap[k] != null) {
                                    state.db_fclass = fclassMap[k];
                                }
                                if (closureMap[k] != null) {
                                    state.db_road_closure = closureMap[k];
                                }
                                if (!Object.keys(state).length) {
                                    return;
                                }
                                try {
                                    map.setFeatureState(
                                        { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: idNum },
                                        state
                                    );
                                } catch (e2) {}
                            });
                        }
                    } catch (e) {}
                }
                try {
                    reapplyRiyadhRoadLayerPaintStates();
                } catch (eR) {}
            }

            window.reapplyRiyadhRoadLiveFeatureStates = reapplyRiyadhRoadLiveFeatureStates;

            window.__riyadhTileSelectionSuppressed = false;
            window.__riyadhTileSelectionFeatureLabel = '';
            /** MVT road id to hide on public + styled layers (draft closure GeoJSON overlay replaces it). */
            window.__riyadhClosureOverlayHiddenRoadId = null;

            /** Hide neutral public underlay for closed roads (styled layer draws closure dashes). */
            function buildPublicLayerOpacityExpression(draftHiddenRoadId) {
                const closedExpr = riyadhRoadClosureExpr;
                const whenOpen =
                    closedExpr != null ? ['case', closedExpr, 0, 1] : 1;
                return nestHideOpacityExpression(whenOpen, parseRiyadhRoadIdNum(draftHiddenRoadId));
            }

            function parseRiyadhRoadIdNum(roadId) {
                if (roadId === null || roadId === undefined || roadId === '') {
                    return NaN;
                }
                const n = parseInt(String(roadId), 10);
                return Number.isNaN(n) ? NaN : n;
            }

            function buildRiyadhRoadIdEqualsExpression(roadIdNum) {
                const n = roadIdNum;
                return [
                    'any',
                    ['==', ['get', 'id'], n],
                    ['==', ['to-string', ['get', 'id']], String(n)],
                    ['==', ['to-number', ['get', 'id']], n],
                ];
            }

            function buildRiyadhRoadIdFilter(selectedId) {
                const n = parseRiyadhRoadIdNum(selectedId);
                if (Number.isNaN(n)) {
                    return ['==', ['get', 'id'], -1];
                }
                return buildRiyadhRoadIdEqualsExpression(n);
            }

            function buildHideRoadOpacityExpression(roadIdNum) {
                if (Number.isNaN(roadIdNum)) {
                    return 1;
                }
                return ['case', buildRiyadhRoadIdEqualsExpression(roadIdNum), 0, 1];
            }

            function nestHideOpacityExpression(baseExpr, roadIdNum) {
                if (Number.isNaN(roadIdNum)) {
                    return baseExpr;
                }
                if (baseExpr === 1) {
                    return buildHideRoadOpacityExpression(roadIdNum);
                }
                return ['case', buildRiyadhRoadIdEqualsExpression(roadIdNum), 0, baseExpr];
            }

            function buildCasingOpacityExpression(baseOpacity, editHiddenId, forceZero) {
                if (forceZero) {
                    return 0;
                }
                if (Number.isNaN(editHiddenId)) {
                    return baseOpacity;
                }
                return ['case', buildRiyadhRoadIdEqualsExpression(editHiddenId), 0, baseOpacity];
            }

            function reapplyClosureIconOpacity(editHiddenId, closureDraftId) {
                if (!map.getLayer(ROAD_CLOSURE_ICON_LAYER_ID) || !riyadhRoadClosureExpr) {
                    return;
                }
                let hideId = null;
                let hidden = false;
                if (!Number.isNaN(editHiddenId)) {
                    hideId = editHiddenId;
                    hidden = true;
                } else if (closureDraftId != null) {
                    hideId = closureDraftId;
                    hidden = true;
                }
                const iconOp = hidden
                    ? riyadhClosureIconOpacityWhenBasemapRoadHidden(hideId, true, riyadhRoadClosureExpr)
                    : ['case', riyadhRoadClosureExpr, 1, 0];
                map.setPaintProperty(ROAD_CLOSURE_ICON_LAYER_ID, 'icon-opacity', iconOp);
            }

            /** Single source of truth for MVT road-network layer opacity after edits, selection, or tile reload. */
            function reapplyRiyadhRoadLayerPaintStates() {
                if (window.__riyadhRoadSuppressMapPaint) {
                    return;
                }
                try {
                    const editHiddenId = parseRiyadhRoadIdNum(window.__roadGeometryEditActiveId);
                    const closureDraftId = window.__riyadhClosureOverlayHiddenRoadId;
                    const selectionSuppressed = !!window.__riyadhTileSelectionSuppressed;

                    let publicOp = buildPublicLayerOpacityExpression(closureDraftId);
                    publicOp = nestHideOpacityExpression(publicOp, editHiddenId);
                    if (map.getLayer(PUBLIC_LAYER_ID)) {
                        map.setPaintProperty(PUBLIC_LAYER_ID, 'line-opacity', publicOp);
                    }

                    let styledOp = 1;
                    styledOp = nestHideOpacityExpression(styledOp, parseRiyadhRoadIdNum(closureDraftId));
                    styledOp = nestHideOpacityExpression(styledOp, editHiddenId);
                    if (map.getLayer(STYLED_LAYER_ID)) {
                        map.setPaintProperty(STYLED_LAYER_ID, 'line-opacity', styledOp);
                    }

                    if (map.getLayer(HOVER_LAYER_ID)) {
                        map.setPaintProperty(
                            HOVER_LAYER_ID,
                            'line-opacity',
                            buildCasingOpacityExpression(0.28, editHiddenId, selectionSuppressed)
                        );
                    }
                    if (map.getLayer(OUTLINE_LAYER_ID)) {
                        map.setPaintProperty(
                            OUTLINE_LAYER_ID,
                            'line-opacity',
                            buildCasingOpacityExpression(MLS.OUTLINE_OPACITY, editHiddenId, selectionSuppressed)
                        );
                    }
                    if (map.getLayer(RING_LAYER_ID)) {
                        map.setPaintProperty(
                            RING_LAYER_ID,
                            'line-opacity',
                            buildCasingOpacityExpression(MLS.RING_OPACITY, editHiddenId, selectionSuppressed)
                        );
                    }
                    if (map.getLayer(SELECTED_LAYER_ID)) {
                        const normalized = String(window.__riyadhTileSelectionFeatureLabel || '')
                            .trim()
                            .toLowerCase();
                        const showCyanCore = !normalized || normalized === 'line';
                        const coreBase = showCyanCore ? MLS.GEOJSON_CORE_OPACITY : 0;
                        map.setPaintProperty(
                            SELECTED_LAYER_ID,
                            'line-opacity',
                            buildCasingOpacityExpression(coreBase, editHiddenId, selectionSuppressed)
                        );
                    }

                    reapplyClosureIconOpacity(editHiddenId, closureDraftId);
                    try {
                        map.triggerRepaint();
                    } catch (ePaint) {}
                } catch (eReapply) {}
            }

            window.reapplyRiyadhRoadLayerPaintStates = reapplyRiyadhRoadLayerPaintStates;

            window.restoreRiyadhRoadNetworkVisibility = function() {
                window.__riyadhClosureOverlayHiddenRoadId = null;
                window.__riyadhTileSelectionSuppressed = false;
                reapplyRiyadhRoadLayerPaintStates();
            };

            window.setRiyadhRoadSelectedId = function(selectedId) {
                try {
                    if (!map.getLayer(SELECTED_LAYER_ID)) {
                        return;
                    }
                    const fl = buildRiyadhRoadIdFilter(selectedId);
                    map.setFilter(SELECTED_LAYER_ID, fl);
                    if (map.getLayer(RING_LAYER_ID)) {
                        map.setFilter(RING_LAYER_ID, fl);
                    }
                    if (map.getLayer(OUTLINE_LAYER_ID)) {
                        map.setFilter(OUTLINE_LAYER_ID, fl);
                    }
                } catch (eSel) {}
            };

            /** Hide MVT selection casing while the draft closure GeoJSON overlay is active. */
            window.setRiyadhTileSelectionSuppressedForOverlay = function (suppressed) {
                window.__riyadhTileSelectionSuppressed = !!suppressed;
                reapplyRiyadhRoadLayerPaintStates();
            };

            // Hide the cyan MVT selection core once a real feature type is chosen so
            // catalog symbology (via db_fclass) remains visible while editing.
            window.syncRiyadhTileSelectionCoreForFeatureLabel = function (featureLabel) {
                window.__riyadhTileSelectionFeatureLabel = featureLabel || '';
                reapplyRiyadhRoadLayerPaintStates();
            };

            function bindRiyadhRoadsSourceSync() {
                if (window.__riyadhRoadsSourceSyncBound) {
                    return;
                }
                window.__riyadhRoadsSourceSyncBound = true;
                let sourceSyncTimer = null;
                map.on('sourcedata', function(e) {
                    if (
                        e.sourceId !== SOURCE_ID ||
                        e.dataType === 'tile' ||
                        !e.isSourceLoaded ||
                        !map.isSourceLoaded(SOURCE_ID) ||
                        window.__riyadhRoadTilesReloading
                    ) {
                        return;
                    }
                    if (sourceSyncTimer) {
                        clearTimeout(sourceSyncTimer);
                    }
                    sourceSyncTimer = setTimeout(function() {
                        sourceSyncTimer = null;
                        try {
                            reapplyRiyadhRoadLiveFeatureStates();
                        } catch (eSync) {}
                    }, 50);
                });
            }

            function ensureRiyadhRoadsSource(version) {
                if (!HAS_RIYADH_ROADS_TILES) {
                    return;
                }
                const bustedUrl = window.buildRiyadhRoadsTileUrl(RIYADH_ROADS_TILE_URL, version);
                const existing = map.getSource(SOURCE_ID);
                if (existing) {
                    return;
                }
                map.addSource(SOURCE_ID, {
                    type: 'vector',
                    tiles: [bustedUrl],
                    minzoom: 0,
                    maxzoom: 14,
                    promoteId: { [SOURCE_LAYER]: 'id' }
                });
                bindRiyadhRoadsSourceSync();
            }

            function refreshRiyadhRoadsSourceTiles(version) {
                if (!HAS_RIYADH_ROADS_TILES) {
                    return false;
                }
                if (typeof window.reloadMaplibreVectorTileSource === 'function') {
                    return window.reloadMaplibreVectorTileSource(
                        map,
                        SOURCE_ID,
                        RIYADH_ROADS_TILE_URL,
                        version
                    );
                }
                return false;
            }

            if (HAS_RIYADH_ROADS_TILES && !map.getSource(SOURCE_ID)) {
                ensureRiyadhRoadsSource(window.__riyadhTilesVersion);
            }
            if (HAS_RIYADH_ROADS_TILES && map.getSource(SOURCE_ID)) {
                bindRiyadhRoadsSourceSync();
            }

            // Public layer shows the Riyadh road network in a single neutral color for all users.
            if (HAS_RIYADH_ROADS_TILES && !map.getLayer(PUBLIC_LAYER_ID)) {
                map.addLayer({
                    id: PUBLIC_LAYER_ID,
                    type: 'line',
                    source: SOURCE_ID,
                    'source-layer': SOURCE_LAYER,
                    layout: {
                        'line-cap': 'round',
                        'line-join': 'round'
                    },
                    paint: {
                        'line-color': RIYADH_PUBLIC_ROAD_LINE_COLOR,
                        'line-width': 2,
                        'line-opacity': 1
                    }
                });
            }

            /** Symbology match: catalog from riyadh_fclass.py; see block comment above. */
            function buildEffectiveFclassExpression() {
                return [
                    'downcase',
                    [
                        'to-string',
                        [
                            'coalesce',
                            ['feature-state', 'db_fclass'],
                            ['get', 'fclass'],
                            ''
                        ]
                    ]
                ];
            }

            function buildMatchExpressionForStyle(stylesByLabel, fclassToLabel, fclassKeys, propName, defaultValue, transform) {
                const keys = Array.isArray(fclassKeys) ? fclassKeys : Object.keys(fclassToLabel || {});
                const effectiveFclass = buildEffectiveFclassExpression();
                const expression = ['match', effectiveFclass];
                keys.forEach(function(raw) {
                    const label = (fclassToLabel && fclassToLabel[raw]) || 'Line';
                    const style = stylesByLabel[label] || stylesByLabel['Line'] || null;
                    const rawValue = style && style[propName] != null ? style[propName] : defaultValue;
                    const value = typeof transform === 'function' ? transform(rawValue) : rawValue;
                    expression.push(raw);
                    expression.push(value);
                });
                expression.push(typeof transform === 'function' ? transform(defaultValue) : defaultValue);
                return expression;
            }

            function normalizeDashArray(rawDash) {
                if (!rawDash || !Array.isArray(rawDash) || rawDash.length < 2) {
                    return [1, 0];
                }
                const a = Number(rawDash[0]);
                const b = Number(rawDash[1]);
                if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < 0) {
                    return [1, 0];
                }
                return [a, b];
            }

            function buildEffectiveRoadClosureExpression() {
                return [
                    'to-number',
                    [
                        'coalesce',
                        ['feature-state', 'db_road_closure'],
                        ['get', 'road_closure'],
                        0
                    ]
                ];
            }

            function applySymbologyPaintToLayer(layerId, colorExpression, widthExpression, dashExpression) {
                if (!map.getLayer(layerId)) {
                    return;
                }
                map.setPaintProperty(layerId, 'line-color', colorExpression);
                map.setPaintProperty(layerId, 'line-width', widthExpression);
                map.setPaintProperty(layerId, 'line-dasharray', dashExpression);
            }

            function ensureRiyadhRoadLayerFromCatalog(catalog) {
                if (!HAS_RIYADH_ROADS_TILES || !map.getSource(SOURCE_ID)) {
                    return;
                }
                const stylesByLabel = catalog && catalog.styles_by_label ? catalog.styles_by_label : null;
                const fclassToLabel = catalog && catalog.riyadh_fclass_to_label ? catalog.riyadh_fclass_to_label : null;
                const fclassKeys = catalog && catalog.riyadh_fclass_keys ? catalog.riyadh_fclass_keys : null;
                if (!stylesByLabel || !stylesByLabel['Line'] || !fclassToLabel || !fclassKeys || !fclassKeys.length) {
                    return;
                }

                const defaultStyle = stylesByLabel['Line'];
                const defaultColor = defaultStyle.lineColor;
                const defaultWidth = defaultStyle.lineWidth;

                const baseColorExpression = buildMatchExpressionForStyle(
                    stylesByLabel,
                    fclassToLabel,
                    fclassKeys,
                    'lineColor',
                    defaultColor
                );
                const baseWidthExpression = buildMatchExpressionForStyle(
                    stylesByLabel,
                    fclassToLabel,
                    fclassKeys,
                    'lineWidth',
                    defaultWidth,
                    function(v) { return Number(v) || defaultWidth; }
                );

                const baseDashExpression = (() => {
                    return buildMatchExpressionForStyle(
                        stylesByLabel,
                        fclassToLabel,
                        fclassKeys,
                        'lineDasharray',
                        [1, 0],
                        function(v) {
                            return ['literal', normalizeDashArray(v)];
                        }
                    );
                })();

                const closureStyle = stylesByLabel['Road Closure'] || null;
                const closureDash = closureStyle ? normalizeDashArray(closureStyle.lineDasharray) : [1, 0];
                const closureColor = closureStyle && closureStyle.lineColor ? closureStyle.lineColor : defaultColor;
                const closureWidth = closureStyle && closureStyle.lineWidth != null ? Number(closureStyle.lineWidth) : defaultWidth;

                const effectiveRoadClosure = buildEffectiveRoadClosureExpression();
                const isClosedExpr = ['==', effectiveRoadClosure, 1];

                const colorExpression = ['case', isClosedExpr, closureColor, baseColorExpression];
                const widthExpression = ['case', isClosedExpr, closureWidth, baseWidthExpression];
                const dashExpression = ['case', isClosedExpr, ['literal', closureDash], baseDashExpression];

                if (!map.getLayer(STYLED_LAYER_ID)) {
                    map.addLayer({
                        id: STYLED_LAYER_ID,
                        type: 'line',
                        source: SOURCE_ID,
                        'source-layer': SOURCE_LAYER,
                        layout: {
                            // Use butt caps so dashed symbology stays crisp (especially Road Closure).
                            'line-cap': 'butt',
                            'line-join': 'round'
                        },
                        paint: {
                            'line-color': colorExpression,
                            'line-width': widthExpression,
                            'line-dasharray': dashExpression,
                            'line-opacity': 1
                        }
                    });

                    // Hover highlight (subtle) — under selection casing.
                    if (!map.getLayer(HOVER_LAYER_ID)) {
                        map.addLayer({
                            id: HOVER_LAYER_ID,
                            type: 'line',
                            source: SOURCE_ID,
                            'source-layer': SOURCE_LAYER,
                            filter: ['==', ['get', 'id'], HOVER_NONE_ID],
                            layout: {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            paint: {
                                'line-color': '#f8fafc',
                                'line-width': ['+', widthExpression, 2],
                                'line-opacity': 0.28,
                                'line-blur': 0.85
                            }
                        });
                    }

                    // Selection casing (under cyan core): white outline + soft cyan ring — shared across all roads.
                    if (!map.getLayer(OUTLINE_LAYER_ID)) {
                        map.addLayer({
                            id: OUTLINE_LAYER_ID,
                            type: 'line',
                            source: SOURCE_ID,
                            'source-layer': SOURCE_LAYER,
                            filter: ['==', ['get', 'id'], -1],
                            layout: {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            paint: {
                                'line-color': MLS.OUTLINE_COLOR,
                                'line-width': MLS.riyadhTileOutlineWidthExpression(widthExpression),
                                'line-opacity': MLS.OUTLINE_OPACITY,
                                'line-blur': MLS.OUTLINE_BLUR,
                            }
                        });
                    }
                    if (!map.getLayer(RING_LAYER_ID)) {
                        map.addLayer({
                            id: RING_LAYER_ID,
                            type: 'line',
                            source: SOURCE_ID,
                            'source-layer': SOURCE_LAYER,
                            filter: ['==', ['get', 'id'], -1],
                            layout: {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            paint: {
                                'line-color': MLS.RING_COLOR,
                                'line-width': MLS.riyadhTileRingWidthExpression(widthExpression),
                                'line-opacity': MLS.RING_OPACITY,
                                'line-blur': MLS.RING_BLUR,
                            }
                        });
                    }

                    // Selected road core: cyan until a feature type is chosen (see syncRiyadhTileSelectionCoreForFeatureLabel).
                    if (!map.getLayer(SELECTED_LAYER_ID)) {
                        map.addLayer({
                            id: SELECTED_LAYER_ID,
                            type: 'line',
                            source: SOURCE_ID,
                            'source-layer': SOURCE_LAYER,
                            filter: ['==', ['get', 'id'], -1],
                            layout: {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            paint: {
                                'line-color': MLS.CORE_COLOR,
                                'line-width': widthExpression,
                                'line-dasharray': [1, 0],
                                'line-opacity': MLS.GEOJSON_CORE_OPACITY,
                            }
                        });
                    }

                    if (isEditingEnabled) {
                        let riyadhHoverRoadId = null;
                        let riyadhHoverRaf = null;

                        function applyRiyadhHoverFilter(roadIdOrNull) {
                            try {
                                if (!map.getLayer(HOVER_LAYER_ID)) {
                                    return;
                                }
                                if (roadIdOrNull == null || Number.isNaN(roadIdOrNull)) {
                                    map.setFilter(HOVER_LAYER_ID, ['==', ['get', 'id'], HOVER_NONE_ID]);
                                    return;
                                }
                                map.setFilter(HOVER_LAYER_ID, buildRiyadhRoadIdFilter(roadIdOrNull));
                            } catch (eH) {}
                        }

                        map.on('click', STYLED_LAYER_ID, async (e) => {
                            try {
                                const features = map.queryRenderedFeatures(e.point, { layers: [STYLED_LAYER_ID] }) || [];
                                if (!features.length) return;

                                const feature = features[0];
                                const props = feature && feature.properties ? feature.properties : {};
                                const rawId = props && props.id != null ? props.id : null;
                                const roadId = rawId != null ? parseInt(rawId, 10) : null;

                                if (!roadId || Number.isNaN(roadId)) return;

                                if (e.originalEvent && typeof e.originalEvent.preventDefault === 'function') {
                                    e.originalEvent.preventDefault();
                                }

                                if (typeof window.openRiyadhRoadById === 'function') {
                                    await window.openRiyadhRoadById(roadId, props, { enterEditMode: false });
                                }
                            } catch (err) {
                            }
                        });

                        map.on('mouseenter', STYLED_LAYER_ID, () => {
                            const canvas = map.getCanvas();
                            canvas.style.cursor = 'pointer';
                            canvas.classList.add('map-road-hover');
                        });
                        map.on('mousemove', STYLED_LAYER_ID, (e) => {
                            const f = e.features && e.features[0];
                            const raw = f && f.properties && f.properties.id != null ? f.properties.id : null;
                            const hid = raw != null ? parseInt(raw, 10) : null;
                            if (hid === riyadhHoverRoadId) {
                                return;
                            }
                            riyadhHoverRoadId = hid;
                            if (riyadhHoverRaf) {
                                cancelAnimationFrame(riyadhHoverRaf);
                            }
                            riyadhHoverRaf = requestAnimationFrame(function() {
                                riyadhHoverRaf = null;
                                applyRiyadhHoverFilter(hid);
                            });
                        });
                        map.on('mouseleave', STYLED_LAYER_ID, () => {
                            const canvas = map.getCanvas();
                            canvas.style.cursor = '';
                            canvas.classList.remove('map-road-hover');
                            riyadhHoverRoadId = null;
                            if (riyadhHoverRaf) {
                                cancelAnimationFrame(riyadhHoverRaf);
                                riyadhHoverRaf = null;
                            }
                            applyRiyadhHoverFilter(null);
                        });
                    }
                } else {
                    try {
                        applySymbologyPaintToLayer(STYLED_LAYER_ID, colorExpression, widthExpression, dashExpression);
                        if (map.getLayer(HOVER_LAYER_ID)) {
                            map.setPaintProperty(HOVER_LAYER_ID, 'line-width', ['+', widthExpression, 2]);
                        }
                        MLS.applySelectedCoreLinePaint(map, SELECTED_LAYER_ID, widthExpression, [1, 0]);
                        if (map.getLayer(OUTLINE_LAYER_ID)) {
                            map.setPaintProperty(
                                OUTLINE_LAYER_ID,
                                'line-width',
                                MLS.riyadhTileOutlineWidthExpression(widthExpression)
                            );
                        }
                        if (map.getLayer(RING_LAYER_ID)) {
                            map.setPaintProperty(
                                RING_LAYER_ID,
                                'line-width',
                                MLS.riyadhTileRingWidthExpression(widthExpression)
                            );
                        }
                    } catch (e) {}
                }

                riyadhRoadClosureExpr = isClosedExpr;
                ensureRoadClosureIconLayer(isClosedExpr);
                syncPublicRoadBasemapVisibility();
                reapplyRiyadhRoadLayerPaintStates();
            }

            function sanitizeLabelingConfig(raw) {
                if (!raw || typeof raw !== 'object') return null;
                const textSize = raw.text_size;
                const fetchLimits = raw.fetch_limits;
                const english = raw.english;
                const arabic = raw.arabic;
                if (!textSize || typeof textSize !== 'object') return null;
                if (!fetchLimits || typeof fetchLimits !== 'object') return null;
                if (!english || typeof english !== 'object') return null;
                if (!arabic || typeof arabic !== 'object') return null;
                if (!Array.isArray(english.font_stack) || !english.font_stack.length) return null;
                if (!Array.isArray(arabic.font_stack) || !arabic.font_stack.length) return null;
                if (!Array.isArray(english.offset_em) || english.offset_em.length !== 2) return null;
                if (!Array.isArray(arabic.offset_em) || arabic.offset_em.length !== 2) return null;

                const cfg = {
                    enabled: raw.enabled === true,
                    min_zoom_en: Number(raw.min_zoom_en),
                    min_zoom_ar: Number(raw.min_zoom_ar),
                    max_zoom: Number(raw.max_zoom),
                    text_size: {
                        base: Number(textSize.base),
                        mid: Number(textSize.mid),
                        high: Number(textSize.high)
                    },
                    text_color: String(raw.text_color),
                    halo_color: String(raw.halo_color),
                    halo_width: Number(raw.halo_width),
                    halo_blur: Number(raw.halo_blur),
                    fetch_debounce_ms: Math.max(0, Number(raw.fetch_debounce_ms)),
                    fetch_limits: {
                        z12: Math.max(200, Number(fetchLimits.z12)),
                        z14: Math.max(300, Number(fetchLimits.z14)),
                        z16: Math.max(400, Number(fetchLimits.z16)),
                    },
                    placement: String(raw.placement),
                    allow_overlap: raw.allow_overlap === true,
                    ignore_placement: raw.ignore_placement === true,
                    symbol_spacing: Number(raw.symbol_spacing),
                    max_angle: Number(raw.max_angle),
                    padding: Number(raw.padding),
                    english: {
                        field: String(english.field),
                        font_stack: english.font_stack,
                        offset_em: english.offset_em,
                        optional: english.optional === true
                    },
                    arabic: {
                        field: String(arabic.field),
                        font_stack: arabic.font_stack,
                        offset_em: arabic.offset_em,
                        optional: arabic.optional === true
                    }
                };

                const requiredNumbers = [
                    cfg.min_zoom_en, cfg.min_zoom_ar, cfg.max_zoom,
                    cfg.text_size.base, cfg.text_size.mid, cfg.text_size.high,
                    cfg.halo_width, cfg.halo_blur, cfg.symbol_spacing,
                    cfg.max_angle, cfg.padding, cfg.fetch_debounce_ms,
                    cfg.fetch_limits.z12, cfg.fetch_limits.z14, cfg.fetch_limits.z16
                ];
                if (requiredNumbers.some(function(v) { return Number.isNaN(v); })) return null;
                if (!cfg.english.field || !cfg.arabic.field) return null;
                if (!cfg.text_color || !cfg.halo_color) return null;
                return cfg;
            }

            function ensureRiyadhRoadLabelsFromCatalog(catalog) {
                const cfg = sanitizeLabelingConfig(catalog && catalog.road_labeling ? catalog.road_labeling : null);
                if (!cfg) {
                    [LABEL_LAYER_ID_EN, LABEL_LAYER_ID_AR].forEach(function(layerId) {
                        if (map.getLayer(layerId)) {
                            map.setLayoutProperty(layerId, 'visibility', 'none');
                        }
                    });
                    const src = map.getSource(LABELS_SOURCE_ID);
                    if (src && typeof src.setData === 'function') {
                        src.setData({ type: 'FeatureCollection', features: [] });
                    }
                    return;
                }
                const beforeLayerId = map.getLayer(HOVER_LAYER_ID) ? HOVER_LAYER_ID : undefined;
                const minZoomForAnyLabel = Math.min(cfg.min_zoom_en, cfg.min_zoom_ar);
                const maxZoomForAnyLabel = Math.max(cfg.max_zoom, minZoomForAnyLabel);
                if (!map.getSource(LABELS_SOURCE_ID)) {
                    map.addSource(LABELS_SOURCE_ID, {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: [] }
                    });
                }
                if (!cfg.enabled) {
                    [LABEL_LAYER_ID_EN, LABEL_LAYER_ID_AR].forEach(function(layerId) {
                        if (map.getLayer(layerId)) {
                            map.setLayoutProperty(layerId, 'visibility', 'none');
                        }
                    });
                    const src = map.getSource(LABELS_SOURCE_ID);
                    if (src && typeof src.setData === 'function') {
                        src.setData({ type: 'FeatureCollection', features: [] });
                    }
                    return;
                }

                const textSizeExpression = [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, cfg.text_size.base,
                    13, cfg.text_size.mid,
                    16, cfg.text_size.high
                ];

                const englishText = [
                    'coalesce',
                    ['to-string', ['get', cfg.english.field]],
                    ''
                ];
                const arabicText = [
                    'coalesce',
                    ['to-string', ['get', cfg.arabic.field]],
                    ''
                ];

                const commonLayout = {
                    'symbol-placement': cfg.placement === 'line' ? 'line' : 'line-center',
                    'symbol-spacing': cfg.symbol_spacing,
                    'text-size': textSizeExpression,
                    'text-max-angle': cfg.max_angle,
                    'text-keep-upright': true,
                    'text-allow-overlap': !!cfg.allow_overlap,
                    'text-ignore-placement': !!cfg.ignore_placement,
                    'text-padding': cfg.padding
                };
                const commonPaint = {
                    'text-color': cfg.text_color,
                    'text-halo-color': cfg.halo_color,
                    'text-halo-width': cfg.halo_width,
                    'text-halo-blur': cfg.halo_blur
                };

                const enFilter = ['!=', englishText, ''];
                const arFilter = ['!=', arabicText, ''];

                if (!map.getLayer(LABEL_LAYER_ID_EN)) {
                    map.addLayer({
                        id: LABEL_LAYER_ID_EN,
                        type: 'symbol',
                        source: LABELS_SOURCE_ID,
                        filter: enFilter,
                        layout: {
                            ...commonLayout,
                            'text-field': englishText,
                            'text-font': cfg.english.font_stack,
                            'text-offset': cfg.english.offset_em,
                            'text-optional': !!cfg.english.optional
                        },
                        paint: commonPaint
                    }, beforeLayerId);
                    map.setLayerZoomRange(LABEL_LAYER_ID_EN, cfg.min_zoom_en, cfg.max_zoom);
                } else {
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'visibility', 'visible');
                    map.setFilter(LABEL_LAYER_ID_EN, enFilter);
                    map.setLayerZoomRange(LABEL_LAYER_ID_EN, cfg.min_zoom_en, cfg.max_zoom);
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'text-field', englishText);
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'text-font', cfg.english.font_stack);
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'text-offset', cfg.english.offset_em);
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'text-size', textSizeExpression);
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'symbol-spacing', cfg.symbol_spacing);
                    map.setLayoutProperty(LABEL_LAYER_ID_EN, 'text-max-angle', cfg.max_angle);
                    map.setPaintProperty(LABEL_LAYER_ID_EN, 'text-color', cfg.text_color);
                    map.setPaintProperty(LABEL_LAYER_ID_EN, 'text-halo-color', cfg.halo_color);
                    map.setPaintProperty(LABEL_LAYER_ID_EN, 'text-halo-width', cfg.halo_width);
                    map.setPaintProperty(LABEL_LAYER_ID_EN, 'text-halo-blur', cfg.halo_blur);
                }

                if (!map.getLayer(LABEL_LAYER_ID_AR)) {
                    map.addLayer({
                        id: LABEL_LAYER_ID_AR,
                        type: 'symbol',
                        source: LABELS_SOURCE_ID,
                        filter: arFilter,
                        layout: {
                            ...commonLayout,
                            'text-field': arabicText,
                            'text-font': cfg.arabic.font_stack,
                            'text-offset': cfg.arabic.offset_em,
                            'text-optional': !!cfg.arabic.optional
                        },
                        paint: commonPaint
                    }, beforeLayerId);
                    map.setLayerZoomRange(LABEL_LAYER_ID_AR, cfg.min_zoom_ar, cfg.max_zoom);
                } else {
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'visibility', 'visible');
                    map.setFilter(LABEL_LAYER_ID_AR, arFilter);
                    map.setLayerZoomRange(LABEL_LAYER_ID_AR, cfg.min_zoom_ar, cfg.max_zoom);
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'text-field', arabicText);
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'text-font', cfg.arabic.font_stack);
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'text-offset', cfg.arabic.offset_em);
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'text-size', textSizeExpression);
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'symbol-spacing', cfg.symbol_spacing);
                    map.setLayoutProperty(LABEL_LAYER_ID_AR, 'text-max-angle', cfg.max_angle);
                    map.setPaintProperty(LABEL_LAYER_ID_AR, 'text-color', cfg.text_color);
                    map.setPaintProperty(LABEL_LAYER_ID_AR, 'text-halo-color', cfg.halo_color);
                    map.setPaintProperty(LABEL_LAYER_ID_AR, 'text-halo-width', cfg.halo_width);
                    map.setPaintProperty(LABEL_LAYER_ID_AR, 'text-halo-blur', cfg.halo_blur);
                }

                window.__riyadhRoadLabelsRuntime = window.__riyadhRoadLabelsRuntime || {
                    abortController: null,
                    debounceHandle: null,
                    config: null,
                    fetchPending: false,
                    requestSeq: 0,
                    lastAppliedRequestSeq: 0,
                    lastRequestKey: null,
                };
                const runtime = window.__riyadhRoadLabelsRuntime;
                runtime.config = {
                    minZoomForAnyLabel,
                    maxZoomForAnyLabel,
                    fetchDebounceMs: cfg.fetch_debounce_ms,
                    fetchLimits: cfg.fetch_limits,
                };
                if (!runtime.setLabelsData) {
                    runtime.setLabelsData = function(featureCollection) {
                        const src = map.getSource(LABELS_SOURCE_ID);
                        if (src && typeof src.setData === 'function') {
                            src.setData(featureCollection);
                        }
                    };
                    runtime.clearLabelsData = function() {
                        runtime.setLabelsData({ type: 'FeatureCollection', features: [] });
                    };
                    runtime.fetchAndSetLabels = async function() {
                        if (!map.getSource(LABELS_SOURCE_ID)) return;
                        const currentConfig = runtime.config || {};
                        const minZoom = Number(currentConfig.minZoomForAnyLabel ?? 12);
                        const maxZoom = Number(currentConfig.maxZoomForAnyLabel ?? 22);
                        const limits = currentConfig.fetchLimits || { z12: 1200, z14: 1800, z16: 2600 };
                        const z = Number(map.getZoom());
                        if (Number.isNaN(z) || z < minZoom || z > maxZoom) {
                            runtime.lastRequestKey = null;
                            runtime.clearLabelsData();
                            return;
                        }
                        const b = map.getBounds();
                        if (!b) return;
                        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
                            .map(function(v) { return Number(v).toFixed(6); })
                            .join(',');
                        const limit = z >= 16
                            ? Number(limits.z16 || 2600)
                            : (z >= 14 ? Number(limits.z14 || 1800) : Number(limits.z12 || 1200));
                        const requestKey = `${bbox}|${limit}`;
                        if (requestKey === runtime.lastRequestKey && runtime.lastAppliedRequestSeq > 0) {
                            return;
                        }
                        runtime.lastRequestKey = requestKey;
                        const requestSeq = ++runtime.requestSeq;
                        if (runtime.abortController && runtime.fetchPending) {
                            runtime.abortController.abort();
                        }
                        runtime.abortController = new AbortController();
                        runtime.fetchPending = true;
                        try {
                            const resp = await fetch(`/mapping/api/riyadh-road-labels/?bbox=${encodeURIComponent(bbox)}&limit=${limit}`, {
                                method: 'GET',
                                headers: { 'Accept': 'application/json' },
                                signal: runtime.abortController.signal,
                            });
                            if (!resp.ok) {
                                throw new Error(`Failed to load road labels (${resp.status})`);
                            }
                            const data = await resp.json();
                            const features = data && Array.isArray(data.features) ? data.features : [];
                            if (requestSeq < runtime.lastAppliedRequestSeq) {
                                return;
                            }
                            runtime.lastAppliedRequestSeq = requestSeq;
                            runtime.setLabelsData({ type: 'FeatureCollection', features: features });
                        } catch (err) {
                            if (!(err && err.name === 'AbortError')) {
                                runtime.clearLabelsData();
                            }
                        } finally {
                            runtime.fetchPending = false;
                        }
                    };
                    runtime.scheduleLabelsRefresh = function() {
                        if (runtime.debounceHandle) clearTimeout(runtime.debounceHandle);
                        const debounceMs = Math.max(0, Number((runtime.config && runtime.config.fetchDebounceMs) || 120));
                        runtime.debounceHandle = setTimeout(function() {
                            runtime.debounceHandle = null;
                            runtime.fetchAndSetLabels();
                        }, debounceMs);
                    };
                }

                if (!window.__riyadhRoadLabelsBound) {
                    window.__riyadhRoadLabelsBound = true;
                    map.on('moveend', runtime.scheduleLabelsRefresh);
                    map.on('zoomend', runtime.scheduleLabelsRefresh);
                }
                runtime.fetchAndSetLabels();
            }

            function requestCatalog() {
                if (!IS_AUTHENTICATED) {
                    return;
                }
                // Require a full catalog (not a partial / corrupted object) so we refetch when needed.
                if (window.symbologyCatalog && window.symbologyCatalog.styles_by_label) {
                    ensureRiyadhRoadLayerFromCatalog(window.symbologyCatalog);
                    ensureRiyadhRoadLabelsFromCatalog(window.symbologyCatalog);
                    syncPublicRoadBasemapVisibility();
                    reapplyRiyadhRoadLiveFeatureStates();
                    return;
                }

                window.__naqelLoadSymbologyCatalog()
                    .then(function (catalog) {
                        ensureRiyadhRoadLayerFromCatalog(catalog);
                        ensureRiyadhRoadLabelsFromCatalog(catalog);
                        syncPublicRoadBasemapVisibility();
                        reapplyRiyadhRoadLiveFeatureStates();
                    })
                    .catch(function () {});
            }

            if (HAS_RIYADH_ROADS_TILES) {
                map.once('idle', function() {
                    try {
                        syncPublicRoadBasemapVisibility();
                        reapplyRiyadhRoadLayerPaintStates();
                    } catch (eInitIdle) {}
                });
            }

            // MVT paint is applied from requestCatalog (initial + prefetch) and after tile reload.
            // line-drawing dispatches symbology:catalogLoaded only after normalizing styles for the UI;
            // map layers do not listen here to avoid duplicate ensureRiyadhRoadLayerFromCatalog work.
            if (IS_AUTHENTICATED) {
                requestCatalog();
            }

            window.setRiyadhRoadBasemapHiddenForClosureOverlay = function (roadId, hidden) {
                try {
                    if (hidden && roadId != null && roadId !== '') {
                        const parsed = parseRiyadhRoadIdNum(roadId);
                        window.__riyadhClosureOverlayHiddenRoadId = Number.isNaN(parsed) ? null : parsed;
                    } else {
                        window.__riyadhClosureOverlayHiddenRoadId = null;
                    }
                    reapplyRiyadhRoadLayerPaintStates();
                } catch (eCl) {}
            };

            window.reloadRiyadhRoadsSource = function(tilesVersion) {
                if (typeof map === 'undefined' || !map) return;
                if (!HAS_RIYADH_ROADS_TILES) return;

                try {
                    const resolved = window.getRiyadhTilesVersionOrDefault(tilesVersion);
                    window.__riyadhTilesVersion = resolved;

                    if (refreshRiyadhRoadsSourceTiles(resolved)) {
                        window.__riyadhRoadTilesReloading = true;
                        waitForRiyadhSourceSettled(finishRiyadhRoadTilesReload);
                        return;
                    }

                    const selectedFilterId = (() => {
                        try {
                            if (map.getLayer(SELECTED_LAYER_ID) && map.getFilter) {
                                return map.getFilter(SELECTED_LAYER_ID) || null;
                            }
                        } catch (e) {}
                        return null;
                    })();

                    // Remove layers first (MapLibre requires this before removing a source).
                    [LABEL_LAYER_ID_AR, LABEL_LAYER_ID_EN, SELECTED_LAYER_ID, RING_LAYER_ID, OUTLINE_LAYER_ID, HOVER_LAYER_ID, ROAD_CLOSURE_ICON_LAYER_ID, STYLED_LAYER_ID, PUBLIC_LAYER_ID].forEach((layerId) => {
                        try {
                            if (map.getLayer(layerId)) {
                                map.removeLayer(layerId);
                            }
                        } catch (e) {}
                    });

                    try {
                        if (map.getSource(LABELS_SOURCE_ID)) {
                            map.removeSource(LABELS_SOURCE_ID);
                        }
                    } catch (e0) {}

                    try {
                        if (map.getSource(SOURCE_ID)) {
                            map.removeSource(SOURCE_ID);
                        }
                    } catch (e) {}

                    // Re-add source with cache-busted URL and rebuild layers.
                    ensureRiyadhRoadsSource(resolved);

                    if (!map.getLayer(PUBLIC_LAYER_ID)) {
                        map.addLayer({
                            id: PUBLIC_LAYER_ID,
                            type: 'line',
                            source: SOURCE_ID,
                            'source-layer': SOURCE_LAYER,
                            layout: { 'line-cap': 'round', 'line-join': 'round' },
                            paint: { 'line-color': RIYADH_PUBLIC_ROAD_LINE_COLOR, 'line-width': 2, 'line-opacity': 1 }
                        });
                    }

                    // If symbology is available, rebuild the styled + selected layers too.
                    try {
                        const catalog = window.symbologyCatalog || null;
                        ensureRiyadhRoadLayerFromCatalog(catalog);
                        ensureRiyadhRoadLabelsFromCatalog(catalog);
                    } catch (e2) {}

                    // Restore selection filter if we had one.
                    if (selectedFilterId && map.getLayer(SELECTED_LAYER_ID)) {
                        try {
                            map.setFilter(SELECTED_LAYER_ID, selectedFilterId);
                            if (map.getLayer(RING_LAYER_ID)) {
                                map.setFilter(RING_LAYER_ID, selectedFilterId);
                            }
                            if (map.getLayer(OUTLINE_LAYER_ID)) {
                                map.setFilter(OUTLINE_LAYER_ID, selectedFilterId);
                            }
                        } catch (e3) {}
                    }

                    try {
                        syncPublicRoadBasemapVisibility();
                        reapplyRiyadhRoadLayerPaintStates();
                    } catch (e4) {}

                    window.__riyadhRoadTilesReloading = true;
                    waitForRiyadhSourceSettled(finishRiyadhRoadTilesReload);
                } catch (e) {}
            };

            if (typeof window.registerRiyadhRoadsTileReloader === 'function') {
                window.registerRiyadhRoadsTileReloader(function (version) {
                    window.reloadRiyadhRoadsSource(version);
                });
            }
    } catch (e) {}
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBasemapGallery);
} else {
    initBasemapGallery();
}
