// KSA Map Editing Module
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

window.__riyadhTilesVersion = null;

function getStoredRiyadhTilesVersion() {
    try {
        const raw = window.localStorage ? window.localStorage.getItem('riyadhTilesVersion') : null;
        if (!raw) return null;
        const trimmed = String(raw).trim();
        return trimmed.length ? trimmed : null;
    } catch (e) {
        return null;
    }
}

function storeRiyadhTilesVersion(version) {
    try {
        if (!window.localStorage) return;
        if (!version) {
            window.localStorage.removeItem('riyadhTilesVersion');
            return;
        }
        window.localStorage.setItem('riyadhTilesVersion', String(version));
    } catch (e) {}
}

function getDefaultRiyadhTilesVersion() {
    return String(Date.now());
}

function getRiyadhTilesVersionOrDefault(version) {
    if (version !== undefined && version !== null) {
        const trimmed = String(version).trim();
        if (trimmed.length) return trimmed;
    }
    return window.__riyadhTilesVersion || getStoredRiyadhTilesVersion() || getDefaultRiyadhTilesVersion();
}

function buildCacheBustedUrl(baseUrl, version) {
    if (!baseUrl) return baseUrl;
    const v = getRiyadhTilesVersionOrDefault(version);
    const sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
    return `${baseUrl}${sep}v=${encodeURIComponent(String(v))}`;
}

window.triggerRiyadhTilesReload = function(tilesVersion) {
    const resolved = getRiyadhTilesVersionOrDefault(tilesVersion);
    window.__riyadhTilesVersion = resolved;
    storeRiyadhTilesVersion(resolved);

    if (typeof window.reloadRiyadhRoadsSource === 'function') {
        window.reloadRiyadhRoadsSource(resolved);
    }
};

function getIsAuthenticated() {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        return true;
    }

    const value = mapElement.getAttribute('data-is-authenticated');
    return value !== 'false';
}

const MAPTILER_API_KEY = getMaptilerApiKey();
const HAS_MAPTILER = !!MAPTILER_API_KEY;
const RIYADH_ROADS_TILE_URL = getRiyadhRoadsTileUrl();
const HAS_RIYADH_ROADS_TILES = !!RIYADH_ROADS_TILE_URL;
const IS_AUTHENTICATED = getIsAuthenticated();
const PUBLIC_ROAD_COLOR = '#fb9a99';

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

// Ensure each page load starts with a fresh tile version so browser/CDN caches
// cannot keep serving stale vector tiles after road mutations.
if (!window.__riyadhTilesVersion) {
    window.__riyadhTilesVersion = getStoredRiyadhTilesVersion() || getDefaultRiyadhTilesVersion();
}
storeRiyadhTilesVersion(window.__riyadhTilesVersion);

const map = new maplibregl.Map({
    container: 'map',
    center: [46.727866, 24.723580],
    zoom: 9.5,
    maxZoom: 19,
    maxBounds: bounds,
    style: {
        version: 8,
        sources: baseSources,
        layers: baseLayers,
    },
});

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
    if (HAS_RIYADH_ROADS_TILES && RIYADH_ROADS_TILE_URL) {
        try {
            const SOURCE_ID = 'riyadh-roads';
            const PUBLIC_LAYER_ID = 'riyadh-roads-public-layer';
            const STYLED_LAYER_ID = 'riyadh-roads-layer';
            const HOVER_LAYER_ID = 'riyadh-roads-hover-layer';
            const MLS = typeof window.MapLineSelection !== 'undefined' ? window.MapLineSelection : null;
            const OUTLINE_LAYER_ID = MLS ? MLS.RIYADH_OUTLINE_LAYER_ID : 'riyadh-roads-selected-outline-layer';
            const RING_LAYER_ID = MLS ? MLS.RIYADH_RING_LAYER_ID : 'riyadh-roads-selected-ring-layer';
            const SELECTED_LAYER_ID = MLS ? MLS.RIYADH_CORE_LAYER_ID : 'riyadh-roads-selected-layer';
            const SOURCE_LAYER = 'riyadh_roads';
            const HOVER_NONE_ID = -999999;

            function ensureRiyadhRoadsSource(version) {
                if (map.getSource(SOURCE_ID)) {
                    return;
                }
                const bustedUrl = buildCacheBustedUrl(RIYADH_ROADS_TILE_URL, version);
                map.addSource(SOURCE_ID, {
                    type: 'vector',
                    tiles: [bustedUrl],
                    minzoom: 0,
                    maxzoom: 14
                });
            }

            if (!map.getSource('riyadh-roads')) {
                ensureRiyadhRoadsSource(window.__riyadhTilesVersion);
            }

            // Public layer shows the Riyadh road network in a single neutral color for all users.
            if (!map.getLayer(PUBLIC_LAYER_ID)) {
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
                        'line-color': PUBLIC_ROAD_COLOR,
                        'line-width': 2,
                        'line-opacity': 1
                    }
                });
            }

            const fclassToLabel = {
                motorway: 'Motorway',
                motorway_link: 'Motorway Link',
                trunk: 'Trunk Road',
                trunk_link: 'Trunk Link',
                primary: 'Primary Road',
                primary_link: 'Primary Link',
                secondary: 'Secondary Road',
                secondary_link: 'Secondary Link',
                tertiary: 'Tertiary Road',
                tertiary_link: 'Tertiary Link',
                residential: 'Residential Road',
                living_street: 'Living Street',
                service: 'Service Road',
                unclassified: 'Unclassified Road',
                track: 'Track / Land-Access Road',
                footway: 'Footway',
                steps: 'Steps',
                path: 'Path',
                cycleway: 'Cycleway'
            };

            function buildMatchExpressionForStyle(stylesByLabel, propName, defaultValue, transform) {
                const keys = Object.keys(fclassToLabel);
                const expression = ['match', ['get', 'fclass']];
                keys.forEach(function(raw) {
                    const label = fclassToLabel[raw] || 'Line';
                    const style = stylesByLabel[label] || stylesByLabel['Line'] || null;
                    const rawValue = style && style[propName] != null ? style[propName] : defaultValue;
                    const value = typeof transform === 'function' ? transform(rawValue) : rawValue;
                    expression.push(raw);
                    expression.push(value);
                });
                expression.push(typeof transform === 'function' ? transform(defaultValue) : defaultValue);
                return expression;
            }

            function ensureRiyadhRoadLayerFromCatalog(catalog) {
                const stylesByLabel = catalog && catalog.styles_by_label ? catalog.styles_by_label : null;
                if (!stylesByLabel || !stylesByLabel['Line']) {
                    return;
                }

                const defaultStyle = stylesByLabel['Line'];
                const defaultColor = defaultStyle.lineColor;
                const defaultWidth = defaultStyle.lineWidth;

                const colorExpression = buildMatchExpressionForStyle(
                    stylesByLabel,
                    'lineColor',
                    defaultColor
                );
                const widthExpression = buildMatchExpressionForStyle(
                    stylesByLabel,
                    'lineWidth',
                    defaultWidth,
                    function(v) { return Number(v) || defaultWidth; }
                );

                if (!map.getLayer(STYLED_LAYER_ID)) {
                    map.addLayer({
                        id: STYLED_LAYER_ID,
                        type: 'line',
                        source: SOURCE_ID,
                        'source-layer': SOURCE_LAYER,
                        layout: {
                            'line-cap': 'round',
                            'line-join': 'round'
                        },
                        paint: {
                            'line-color': colorExpression,
                            'line-width': widthExpression,
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

                    // Selection casing (under symbology core): dark outline + light ring — shared across all roads.
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
                                'line-color': MLS ? MLS.OUTLINE_COLOR : '#0f172a',
                                'line-width': MLS ? MLS.riyadhTileOutlineWidthExpression(widthExpression) : ['+', widthExpression, 7],
                                'line-opacity': MLS ? MLS.OUTLINE_OPACITY : 0.93,
                                'line-blur': MLS ? MLS.OUTLINE_BLUR : 0.45
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
                                'line-color': MLS ? MLS.RING_COLOR : '#ffffff',
                                'line-width': MLS ? MLS.riyadhTileRingWidthExpression(widthExpression) : ['+', widthExpression, 4],
                                'line-opacity': MLS ? MLS.RING_OPACITY : 1,
                                'line-blur': MLS ? MLS.RING_BLUR : 0
                            }
                        });
                    }

                    // Selected road core: catalog symbology (color / width / dash).
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
                                'line-color': colorExpression,
                                'line-width': widthExpression,
                                'line-opacity': 1
                            }
                        });

                        // Selection filter on outline, ring, and core (keeps hit-testing on STYLED_LAYER).
                        window.setRiyadhRoadSelectedId = function(selectedId) {
                            try {
                                if (!map.getLayer(SELECTED_LAYER_ID)) {
                                    return;
                                }
                                const emptyFl = ['==', ['get', 'id'], -1];
                                if (!selectedId && selectedId !== 0) {
                                    map.setFilter(SELECTED_LAYER_ID, emptyFl);
                                    if (map.getLayer(RING_LAYER_ID)) {
                                        map.setFilter(RING_LAYER_ID, emptyFl);
                                    }
                                    if (map.getLayer(OUTLINE_LAYER_ID)) {
                                        map.setFilter(OUTLINE_LAYER_ID, emptyFl);
                                    }
                                    return;
                                }
                                const fl = ['==', ['get', 'id'], selectedId];
                                map.setFilter(SELECTED_LAYER_ID, fl);
                                if (map.getLayer(RING_LAYER_ID)) {
                                    map.setFilter(RING_LAYER_ID, fl);
                                }
                                if (map.getLayer(OUTLINE_LAYER_ID)) {
                                    map.setFilter(OUTLINE_LAYER_ID, fl);
                                }
                            } catch (e) {
                            }
                        };
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
                                map.setFilter(HOVER_LAYER_ID, ['==', ['get', 'id'], roadIdOrNull]);
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

                                // Update the highlight layer immediately so the
                                // user sees which road is selected even before
                                // the details API responds.
                                if (typeof window.setRiyadhRoadSelectedId === 'function') {
                                    window.setRiyadhRoadSelectedId(roadId);
                                }
                                if (typeof window.applyMapSidePanelOpen === 'function') {
                                    window.applyMapSidePanelOpen(true);
                                }

                                const url = `/mapping/api/riyadh-road/${roadId}/`;
                                const resp = await fetch(url, {
                                    method: 'GET',
                                    headers: { 'Content-Type': 'application/json' }
                                });
                                if (!resp.ok) return;

                                const data = await resp.json();
                                if (!data || !data.success || !data.road) return;

                                // Tiles often include name/ref while the DB `name` column can be empty
                                // for the same feature; prefer DB when set, otherwise use tile attributes.
                                const fd = data.road.fields_data || {};
                                const firstTileString = function () {
                                    for (let i = 0; i < arguments.length; i++) {
                                        const x = arguments[i];
                                        if (x == null) {
                                            continue;
                                        }
                                        const s = String(x).trim();
                                        if (s !== '') {
                                            return s;
                                        }
                                    }
                                    return '';
                                };
                                const tName = firstTileString(
                                    props.name,
                                    props.Name,
                                    props.NAME,
                                );
                                const tRef = firstTileString(props.ref, props.Ref, props.REF);
                                if (!String(fd.name || '').trim() && tName) {
                                    fd.name = tName;
                                }
                                if (!String(fd.ref || '').trim() && tRef) {
                                    fd.ref = tRef;
                                }
                                data.road.fields_data = fd;
                                const skipTags = { name: true, road_closure: true };
                                data.road.tags_data = [];
                                Object.keys(fd).forEach(function (k) {
                                    if (skipTags[k]) {
                                        return;
                                    }
                                    const v = fd[k];
                                    if (v === undefined || v === null || v === '') {
                                        return;
                                    }
                                    data.road.tags_data.push({ key: k, value: String(v) });
                                });

                                try {
                                    if (!window.riyadhRoadOriginalState) {
                                        window.riyadhRoadOriginalState = {};
                                    }
                                    const originalLabel = data.road.current_feature_label || data.road.feature_type || 'Line';
                                    window.riyadhRoadOriginalState[String(roadId)] = {
                                        feature_label: originalLabel,
                                        geometry: data.road.geometry
                                            ? JSON.parse(JSON.stringify(data.road.geometry))
                                            : null
                                    };
                                    data.road._original_feature_label = originalLabel;
                                } catch (e2) {}

                                window.selectedRiyadhRoad = data.road;
                                window.approvedLineBeingEdited = data.road;

                                if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showRiyadhRoadAsLineFeature === 'function') {
                                    window.lineDrawingHandler.showRiyadhRoadAsLineFeature(data.road);
                                } else if (typeof window.showRiyadhRoadAsLineFeature === 'function') {
                                    window.showRiyadhRoadAsLineFeature(data.road);
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
                        map.setPaintProperty(STYLED_LAYER_ID, 'line-color', colorExpression);
                        map.setPaintProperty(STYLED_LAYER_ID, 'line-width', widthExpression);
                    } catch (e) {}
                }
            }

            function requestCatalog() {
                if (!IS_AUTHENTICATED) {
                    return;
                }
                if (window.symbologyCatalog) {
                    ensureRiyadhRoadLayerFromCatalog(window.symbologyCatalog);
                    return;
                }

                fetch('/symbology/api/catalog/', {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                })
                    .then(function(resp) {
                        if (!resp.ok) {
                            throw new Error('Failed to load symbology catalog');
                        }
                        return resp.json();
                    })
                    .then(function(catalog) {
                        window.symbologyCatalog = catalog;
                        try {
                            window.dispatchEvent(new CustomEvent('symbology:catalogLoaded', { detail: catalog }));
                        } catch (e) {}
                        ensureRiyadhRoadLayerFromCatalog(catalog);
                    })
                    .catch(function() {});
            }

            if (IS_AUTHENTICATED) {
                window.addEventListener('symbology:catalogLoaded', function(e) {
                    const catalog = e && e.detail ? e.detail : window.symbologyCatalog;
                    ensureRiyadhRoadLayerFromCatalog(catalog);
                });
            }
            requestCatalog();

            /**
             * While editing geometry, hide the vector-tile rendition of this road
             * (public + styled + selection) so only the GeoJSON overlay + ghost baseline show.
             */
            window.setRiyadhRoadBasemapHiddenForEdit = function(roadIdToHide, hidden) {
                try {
                    const n =
                        roadIdToHide === null || roadIdToHide === undefined
                            ? NaN
                            : parseInt(String(roadIdToHide), 10);
                    if (hidden && Number.isNaN(n)) {
                        return;
                    }
                    const op =
                        !hidden || Number.isNaN(n)
                            ? 1
                            : [
                                  'case',
                                  [
                                      'any',
                                      ['==', ['get', 'id'], n],
                                      ['==', ['to-string', ['get', 'id']], String(n)],
                                      ['==', ['to-number', ['get', 'id']], n],
                                  ],
                                  0,
                                  1,
                              ];
                    [PUBLIC_LAYER_ID, STYLED_LAYER_ID, HOVER_LAYER_ID, OUTLINE_LAYER_ID, RING_LAYER_ID, SELECTED_LAYER_ID].forEach((lid) => {
                        try {
                            if (map.getLayer(lid)) {
                                map.setPaintProperty(lid, 'line-opacity', op);
                            }
                        } catch (e2) {}
                    });
                } catch (e3) {}
            };

            window.reloadRiyadhRoadsSource = function(tilesVersion) {
                if (typeof map === 'undefined' || !map) return;

                try {
                    const resolved = getRiyadhTilesVersionOrDefault(tilesVersion);
                    window.__riyadhTilesVersion = resolved;
                    storeRiyadhTilesVersion(resolved);

                    const selectedFilterId = (() => {
                        try {
                            if (map.getLayer(SELECTED_LAYER_ID) && map.getFilter) {
                                return map.getFilter(SELECTED_LAYER_ID) || null;
                            }
                        } catch (e) {}
                        return null;
                    })();

                    // Remove layers first (MapLibre requires this before removing a source).
                    [SELECTED_LAYER_ID, RING_LAYER_ID, OUTLINE_LAYER_ID, HOVER_LAYER_ID, STYLED_LAYER_ID, PUBLIC_LAYER_ID].forEach((layerId) => {
                        try {
                            if (map.getLayer(layerId)) {
                                map.removeLayer(layerId);
                            }
                        } catch (e) {}
                    });

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
                            paint: { 'line-color': PUBLIC_ROAD_COLOR, 'line-width': 2, 'line-opacity': 1 }
                        });
                    }

                    // If symbology is available, rebuild the styled + selected layers too.
                    try {
                        const catalog = window.symbologyCatalog || null;
                        ensureRiyadhRoadLayerFromCatalog(catalog);
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

                    if (
                        window.__roadGeometryEditActiveId != null &&
                        typeof window.setRiyadhRoadBasemapHiddenForEdit === 'function'
                    ) {
                        try {
                            window.setRiyadhRoadBasemapHiddenForEdit(
                                window.__roadGeometryEditActiveId,
                                true
                            );
                        } catch (e4) {}
                    }
                } catch (e) {}
            };
        } catch (e) {}
    }

    if (!map.hasImage('road-closure')) {
        map.loadImage('/static/images/icons/road_closure.png', (error, image) => {
            if (error || !image) {
                console.error('Failed to load road-closure icon from /static/images/icons/road_closure.png', error);
            } else if (!map.hasImage('road-closure')) {
                map.addImage('road-closure', image);
            }
        });
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBasemapGallery);
} else {
    initBasemapGallery();
}
