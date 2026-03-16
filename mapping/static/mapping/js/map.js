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

    // Cache bust vector tiles using URL versioning.
    // This avoids issues with browsers blocking access to storage.
    try {
        const params = new URLSearchParams(window.location.search || '');
        const tilesV = params.get('tiles_v');
        if (tilesV) {
            const sep = trimmed.indexOf('?') >= 0 ? '&' : '?';
            return `${trimmed}${sep}v=${encodeURIComponent(tilesV)}`;
        }
    } catch (e) {}

    return trimmed;
}

window.triggerRiyadhTilesReload = function() {
    if (typeof window.reloadRiyadhRoadsSource === 'function') {
        window.reloadRiyadhRoadsSource();
        return;
    }
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('tiles_v', String(Date.now()));
        window.location.href = url.toString();
    } catch (e) {
        window.location.reload();
    }
};

function getIsAuthenticated() {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        return true;
    }

    const value = mapElement.getAttribute('data-is-authenticated');
    // Default to true so authenticated pages without the attribute still enable symbology.
    // Public/landing pages should explicitly set data-is-authenticated="false".
    return value !== 'false';
}

const MAPTILER_API_KEY = getMaptilerApiKey();
const HAS_MAPTILER = !!MAPTILER_API_KEY;
const RIYADH_ROADS_TILE_URL = getRiyadhRoadsTileUrl();
const HAS_RIYADH_ROADS_TILES = !!RIYADH_ROADS_TILE_URL;
const IS_AUTHENTICATED = getIsAuthenticated();
const PUBLIC_ROAD_COLOR = '#fb9a99';

// Basemap definitions: raster sources/layers for MapLibre; MapTiler basemaps added when API key present.
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
            if (!map.getSource('riyadh-roads')) {
                map.addSource('riyadh-roads', {
                    type: 'vector',
                    tiles: [RIYADH_ROADS_TILE_URL],
                    minzoom: 0,
                    maxzoom: 14
                });
            }

            // Public layer shows the Riyadh road network in a single neutral color for all users.
            if (!map.getLayer('riyadh-roads-public-layer')) {
                map.addLayer({
                    id: 'riyadh-roads-public-layer',
                    type: 'line',
                    source: 'riyadh-roads',
                    'source-layer': 'riyadh_roads',
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

            // Public click-to-login is handled by `public-approved-lines.js`.

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
                track: 'Track / Land-Access Road'
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

                if (!map.getLayer('riyadh-roads-layer')) {
                    map.addLayer({
                        id: 'riyadh-roads-layer',
                        type: 'line',
                        source: 'riyadh-roads',
                        'source-layer': 'riyadh_roads',
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

                    // Highlight layer for the currently selected Riyadh road, rendered above the base network.
                    if (!map.getLayer('riyadh-roads-selected-layer')) {
                        map.addLayer({
                            id: 'riyadh-roads-selected-layer',
                            type: 'line',
                            source: 'riyadh-roads',
                            'source-layer': 'riyadh_roads',
                            filter: ['==', ['get', 'id'], -1],
                            layout: {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            paint: {
                                // Slightly thicker than the base layer to keep symbology while emphasizing selection.
                                'line-color': colorExpression,
                                'line-width': ['+', widthExpression, 2],
                                'line-opacity': 1
                            }
                        });

                        // Simple helper to update the current selection filter.
                        window.setRiyadhRoadSelectedId = function(selectedId) {
                            try {
                                if (!map.getLayer('riyadh-roads-selected-layer')) {
                                    return;
                                }
                                if (!selectedId && selectedId !== 0) {
                                    map.setFilter('riyadh-roads-selected-layer', ['==', ['get', 'id'], -1]);
                                    return;
                                }
                                map.setFilter('riyadh-roads-selected-layer', ['==', ['get', 'id'], selectedId]);
                            } catch (e) {
                                // Non-critical
                            }
                        };
                    }

                    if (isEditingEnabled) {
                        map.on('click', 'riyadh-roads-layer', async (e) => {
                            try {
                                const features = map.queryRenderedFeatures(e.point, { layers: ['riyadh-roads-layer'] }) || [];
                                if (!features.length) return;

                                const props = features[0] && features[0].properties ? features[0].properties : {};
                                const rawId = props && props.id != null ? props.id : null;
                                const roadId = rawId != null ? parseInt(rawId, 10) : null;
                                if (!roadId || Number.isNaN(roadId)) return;

                                // Update the highlight layer immediately so the
                                // user sees which road is selected even before
                                // the details API responds.
                                if (typeof window.setRiyadhRoadSelectedId === 'function') {
                                    window.setRiyadhRoadSelectedId(roadId);
                                }

                                const url = `/mapping/api/riyadh-road/${roadId}/`;
                                const resp = await fetch(url, {
                                    method: 'GET',
                                    headers: { 'Content-Type': 'application/json' }
                                });
                                if (!resp.ok) return;
                                const data = await resp.json();
                                if (!data || !data.success || !data.road) return;

                                try {
                                    if (!window.riyadhRoadOriginalState) {
                                        window.riyadhRoadOriginalState = {};
                                    }
                                    const originalLabel = data.road.current_feature_label || data.road.feature_type || 'Line';
                                    window.riyadhRoadOriginalState[String(roadId)] = { feature_label: originalLabel };
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

                        map.on('mouseenter', 'riyadh-roads-layer', () => {
                            map.getCanvas().style.cursor = 'pointer';
                        });
                        map.on('mouseleave', 'riyadh-roads-layer', () => {
                            map.getCanvas().style.cursor = '';
                        });
                    }
                } else {
                    try {
                        map.setPaintProperty('riyadh-roads-layer', 'line-color', colorExpression);
                        map.setPaintProperty('riyadh-roads-layer', 'line-width', widthExpression);
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

            // Helper to reload Riyadh roads tiles by recreating the vector source and layers with a cache-busting URL.
            window.reloadRiyadhRoadsSource = function() {
                if (typeof map === 'undefined' || !map) {
                    return;
                }

                try {
                    if (map.getLayer('riyadh-roads-layer')) {
                        map.removeLayer('riyadh-roads-layer');
                    }
                    if (map.getLayer('riyadh-roads-selected-layer')) {
                        map.removeLayer('riyadh-roads-selected-layer');
                    }
                    if (map.getLayer('riyadh-roads-public-layer')) {
                        map.removeLayer('riyadh-roads-public-layer');
                    }
                    if (map.getSource('riyadh-roads')) {
                        map.removeSource('riyadh-roads');
                    }
                } catch (e) {}

                try {
                    const baseUrl = RIYADH_ROADS_TILE_URL;
                    const sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
                    const bustedUrl = `${baseUrl}${sep}_t=${Date.now()}`;

                    map.addSource('riyadh-roads', {
                        type: 'vector',
                        tiles: [bustedUrl],
                        minzoom: 0,
                        maxzoom: 14
                    });

                    map.addLayer({
                        id: 'riyadh-roads-public-layer',
                        type: 'line',
                        source: 'riyadh-roads',
                        'source-layer': 'riyadh_roads',
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

                    if (window.symbologyCatalog) {
                        ensureRiyadhRoadLayerFromCatalog(window.symbologyCatalog);
                    }
                } catch (e2) {}
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
    } else {
        // No-op: approved roads are served via the Riyadh road tiles.
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBasemapGallery);
} else {
    initBasemapGallery();
}
