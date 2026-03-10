// KSA Map Editing Module - JavaScript

// Map container helpers
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

// Riyadh roads tile service URL from RIYADH_ROADS_TILE_URL (via data attribute).
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
    return trimmed.length ? trimmed : null;
}

const MAPTILER_API_KEY = getMaptilerApiKey();
const HAS_MAPTILER = !!MAPTILER_API_KEY;
const RIYADH_ROADS_TILE_URL = getRiyadhRoadsTileUrl();
const HAS_RIYADH_ROADS_TILES = !!RIYADH_ROADS_TILE_URL;

// Basemap definitions for the application.
// Each definition is mapped to a dedicated raster source and layer in the MapLibre style.
// Only MapTiler-backed basemaps are created when an API key is present.
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

// Default basemap: Streets when MapTiler is available, otherwise Satellite.
let currentBasemapId = HAS_MAPTILER ? 'maptiler-streets' : 'esri-satellite';

// Riyadh, KSA bounds [[neLng, neLat], [swLng, swLat]]
const bounds = [
    [45.475, 23.981], // Northeast
    [48.733, 25.664], // Southwest
];

// Build MapLibre style: raster sources and layers for each basemap.
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

// Initialize map
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

// Toggle basemap layers so only one background is visible.
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
    // Initialize TerraDraw control for editing pages only
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

// Track currently selected item (TerraDraw line)
window.currentlySelectedItem = null;
window.currentlySelectedItemType = null; // 'terradraw-line'

if (drawInstance) {
    drawInstance.on('select', (id) => {
        const snapshot = drawInstance.getSnapshot();
        const features = snapshot?.find((feature) => feature.id === id);
        selectedFeature = JSON.stringify(features);
        // Update selection tracking
        window.currentlySelectedItem = id;
        window.currentlySelectedItemType = 'terradraw-line';

        // Switching back to user-drawn editing: clear tile-selected Riyadh road state
        // so save/edit flows don't accidentally target the road network.
        window.selectedRiyadhRoad = null;
    });
    
    drawInstance.on('deselect', () => {
        // Clear selection tracking when TerraDraw deselects
        if (window.currentlySelectedItemType === 'terradraw-line') {
            window.currentlySelectedItem = null;
            window.currentlySelectedItemType = null;
        }
    });
    
    // Listen for finish event to handle line drawing
    drawInstance.on('finish', (id) => {
        const snapshot = drawInstance.getSnapshot();
        const feature = snapshot?.find(f => f.id === id);
        
        // If it's a line, trigger line drawing handler
        if (feature && feature.geometry && feature.geometry.type === 'LineString') {
            // The line-drawing.js will handle this, but we ensure the event is captured
        }

        // New geometry creation should never be treated as a Riyadh road edit.
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

    // Show clearly labelled longitude and latitude
    el.textContent = `Lon: ${lng}, Lat: ${lat}`;
    el.classList.remove('hidden');
}

map.on('mousemove', (e) => {
    updateCoordinateDisplay(e.lngLat);
});


// Map load event
map.on('load', () => {
    // Ensure initial basemap visibility is applied
    setBasemapVisibility(currentBasemapId);

    // Add Riyadh roads vector tile layer as the network visualization.
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
                        'line-color': '#ff0000',
                        'line-width': 2
                    }
                });
            }

            // Clickable Riyadh roads: resolve tile feature -> DB details -> open sidebar.
            // Only enabled on pages that include the editing sidebar.
            if (isEditingEnabled) {
                map.on('click', 'riyadh-roads-layer', async (e) => {
                try {
                    const features = map.queryRenderedFeatures(e.point, { layers: ['riyadh-roads-layer'] }) || [];
                    if (!features.length) return;

                    // Prefer the DB primary key that is included in tile properties as `id`.
                    const props = (features[0] && features[0].properties) ? features[0].properties : {};
                    const rawId = props && props.id != null ? props.id : null;
                    const roadId = rawId != null ? parseInt(rawId, 10) : null;
                    if (!roadId || Number.isNaN(roadId)) return;

                    const resp = await fetch(`/mapping/api/riyadh-road/${roadId}/`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (!resp.ok) return;
                    const data = await resp.json();
                    if (!data || !data.success || !data.road) return;

                    // Shared selection state used by the save/edit modules.
                    window.selectedRiyadhRoad = data.road;
                    window.approvedLineBeingEdited = data.road;

                    // Draw a highlighted "selected road" overlay using the same
                    // internal visualization logic as feature-type changes.
                    if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showRiyadhRoadAsLineFeature === 'function') {
                        window.lineDrawingHandler.showRiyadhRoadAsLineFeature(data.road);
                    } else if (typeof window.showRiyadhRoadAsLineFeature === 'function') {
                        window.showRiyadhRoadAsLineFeature(data.road);
                    } else if (typeof window.showApprovedLineDetails === 'function') {
                        window.showApprovedLineDetails(data.road, true);
                    }
                } catch (err) {
                    // Non-critical: leave tile rendering intact if selection fails.
                }
                });

                map.on('mouseenter', 'riyadh-roads-layer', () => {
                    map.getCanvas().style.cursor = 'pointer';
                });
                map.on('mouseleave', 'riyadh-roads-layer', () => {
                    map.getCanvas().style.cursor = '';
                });
            }
        } catch (e) {}
    }

    if (!map.hasImage('road-closure')) {
        map.loadImage('/static/images/icons/road_closure.png', (error, image) => {
            if (error || !image) {
                console.error('Failed to load road-closure icon from /static/images/icons/road_closure.png', error);
            } else if (!map.hasImage('road-closure')) {
                map.addImage('road-closure', image);
            }

            if (typeof window.reloadApprovedLines === 'function') {
                try {
                    window.reloadApprovedLines();
                } catch (e) {
                    // Non-critical; approved lines will still render without icons.
                }
            }
        });
    } else {
        // Icon already registered (e.g. style reinitialization). Safe to load
        // approved lines immediately.
        if (typeof window.reloadApprovedLines === 'function') {
            try {
                window.reloadApprovedLines();
            } catch (e) {
                // Non-critical.
            }
        }
    }
});

// Initialize basemap gallery once DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBasemapGallery);
} else {
    initBasemapGallery();
}
