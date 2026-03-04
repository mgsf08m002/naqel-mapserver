// KSA Map Editing Module - JavaScript

// ─── MapTiler / Basemap Configuration ───────────────────────────────────────
// API key is read from data-maptiler-api-key on the map container,
// populated by the Django backend from environment variables only.
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

const MAPTILER_API_KEY = getMaptilerApiKey();
const HAS_MAPTILER = !!MAPTILER_API_KEY;

/**
 * Basemap definitions for the application.
 *
 * Each definition is mapped to a dedicated raster source and layer in the
 * MapLibre style. Only MapTiler-backed basemaps are created when an API
 * key is present.
 */
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

/**
 * Set basemap visibility by toggling layers. Only the selected layer is visible.
 */
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

// Basemap gallery UI state classes
const BASEMAP_SELECTED_CLASSES = ['ring-2', 'ring-blue-500', 'shadow-lg', 'border-blue-500'];
const BASEMAP_UNSELECTED_CLASSES = ['border-transparent', 'opacity-80'];

/**
 * Sync basemap gallery buttons to reflect the current selection.
 */
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

/**
 * Initialize basemap gallery: click handlers, selection sync, and toggle.
 */
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

// Add zoom and rotation controls to the map
map.addControl(new maplibregl.NavigationControl({
    visualizePitch: true,
    visualizeRoll: true,
    showZoom: true,
    showCompass: true
}));

// Add geolocate control to the map
map.addControl(
    new maplibregl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true
    })
);

// Add full Screen Control to the map
const fullscreenControl = new maplibregl.FullscreenControl();
map.addControl(fullscreenControl, 'top-right');

// Initialize TerraDraw control
// By default, all terra-draw drawing modes are enabled.
// you can disable some of modes in the constructor options if you want.
const draw = new MaplibreTerradrawControl.MaplibreTerradrawControl({
    modes: [
        // 'render', comment this to always show drawing tool
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

// Handle feature selection
const drawInstance = draw.getTerraDrawInstance();
let selectedFeature = null;

// Track currently selected item (Riyadh road or TerraDraw line)
window.currentlySelectedItem = null;
window.currentlySelectedItemType = null; // 'riyadh-road' or 'terradraw-line'

if (drawInstance) {
    drawInstance.on('select', (id) => {
        const snapshot = drawInstance.getSnapshot();
        const features = snapshot?.find((feature) => feature.id === id);
        selectedFeature = JSON.stringify(features);
        
        // Clear any previously selected Riyadh road when TerraDraw line is selected
        if (window.currentlySelectedItemType === 'riyadh-road') {
            clearSelectedRiyadhRoad();
        }
        
        // Update selection tracking
        window.currentlySelectedItem = id;
        window.currentlySelectedItemType = 'terradraw-line';
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

// Mouse move event to display longitude/latitude at bottom center
map.on('mousemove', (e) => {
    updateCoordinateDisplay(e.lngLat);
});

/**
 * Map Riyadh road fclass to LINE feature label
 */
function mapFclassToFeatureLabel(fclass) {
    if (!fclass) return 'Line';
    
    const mapping = {
        'motorway': 'Motorway',
        'trunk': 'Trunk Road',
        'primary': 'Primary Road',
        'secondary': 'Secondary Road',
        'tertiary': 'Tertiary Road',
        'residential': 'Residential Road',
        'living_street': 'Living Street',
        'service': 'Service Road',
        'track': 'Track / Land-Access Road',
        'unclassified': 'Minor/Unclassified Road',
        'motorway_link': 'Motorway Link',
        'trunk_link': 'Trunk Link',
        'primary_link': 'Primary Link',
        'secondary_link': 'Secondary Link',
        'tertiary_link': 'Tertiary Link'
    };
    
    const normalizedFclass = fclass.toLowerCase().trim();
    return mapping[normalizedFclass] || 'Line';
}

/**
 * Convert MultiLineString to LineString by taking the first line segment
 */
function convertMultiLineStringToLineString(geometry) {
    if (geometry.type === 'LineString') {
        return geometry;
    }
    
    if (geometry.type === 'MultiLineString') {
        // Take the first LineString from MultiLineString
        // If coordinates have 3 dimensions, extract only lat/lon (drop Z)
        const coordinates = geometry.coordinates[0].map(coord => {
            // Return [lon, lat] - first two elements only
            return coord.slice(0, 2);
        });
        
        return {
            type: 'LineString',
            coordinates: coordinates
        };
    }
    
    return null;
}

/**
 * Convert Riyadh road feature to LINE feature format
 */
function convertRiyadhRoadToLineFeature(riyadhRoadFeature) {
    const props = riyadhRoadFeature.properties;
    const geometry = riyadhRoadFeature.geometry;
    
    // Convert MultiLineString to LineString if needed
    const lineGeometry = convertMultiLineStringToLineString(geometry);
    if (!lineGeometry) {
        console.error('Unable to convert geometry to LineString');
        return null;
    }
    
    // Map fclass to feature label
    const featureLabel = mapFclassToFeatureLabel(props.fclass);
    
    // Build fields_data from Riyadh road properties
    const fieldsData = {
        name: props.name || '',
        code: props.code || null,
        ref: props.ref || '',
        maxspeed: props.maxspeed || null,
        oneway: props.oneway || '',
        bridge: props.bridge || '',
        tunnel: props.tunnel || '',
        layer: props.layer || null,
        shape_length: props.shape_length || null,
        osm_id: props.osm_id || '',
        objectid: props.objectid || null
    };
    
    // Build tags_data from Riyadh road properties
    const tagsData = [];
    if (props.fclass) tagsData.push({key: 'fclass', value: props.fclass});
    if (props.code) tagsData.push({key: 'code', value: String(props.code)});
    if (props.ref) tagsData.push({key: 'ref', value: props.ref});
    if (props.osm_id) tagsData.push({key: 'osm_id', value: props.osm_id});
    if (props.maxspeed) tagsData.push({key: 'maxspeed', value: String(props.maxspeed)});
    if (props.oneway) tagsData.push({key: 'oneway', value: props.oneway});
    if (props.bridge) tagsData.push({key: 'bridge', value: props.bridge});
    if (props.tunnel) tagsData.push({key: 'tunnel', value: props.tunnel});
    if (props.layer !== null && props.layer !== undefined) tagsData.push({key: 'layer', value: String(props.layer)});
    if (props.shape_length) tagsData.push({key: 'shape_length', value: String(props.shape_length)});
    if (props.objectid) tagsData.push({key: 'objectid', value: String(props.objectid)});
    
    return {
        id: props.id || null, // Riyadh road ID
        geometry: lineGeometry,
        feature_type: featureLabel,
        current_feature_label: featureLabel,
        fields_data: fieldsData,
        tags_data: tagsData,
        relations_data: [],
        is_riyadh_road: true // Flag to identify this as a Riyadh road
    };
}

/**
 * Clear previously selected Riyadh road visualization
 */
function clearSelectedRiyadhRoad() {
    if (!window.currentlySelectedItem || window.currentlySelectedItemType !== 'riyadh-road') {
        return;
    }
    
    const previousRoadId = window.currentlySelectedItem;
    
    if (typeof map !== 'undefined' && map) {
        const sourceId = 'riyadh-road-selected-source-' + previousRoadId;
        const glowLayerId = 'riyadh-road-selected-glow-' + previousRoadId;
        const layerId = 'riyadh-road-selected-layer-' + previousRoadId;
        
        try {
            // Remove layers
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getLayer(glowLayerId)) {
                map.removeLayer(glowLayerId);
            }
            // Remove source
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
        } catch (e) {
            // Error removing layers/source
        }
    }
    
    // Clear vertex markers for Riyadh roads if they exist
    if (typeof window.clearVertexMarkers === 'function') {
        window.clearVertexMarkers();
    }
}

/**
 * Clear any previously selected item (Riyadh road or TerraDraw line)
 */
function clearPreviousSelection() {
    // Clear TerraDraw line selection if active
    if (window.currentlySelectedItemType === 'terradraw-line') {
        if (typeof drawInstance !== 'undefined' && drawInstance) {
            try {
                drawInstance.deselect();
            } catch (e) {
                // Could not deselect, continue anyway
            }
        }
        // Also call handleFeatureDeselected if available
        if (window.lineDrawingHandler && typeof window.lineDrawingHandler.handleFeatureDeselected === 'function') {
            window.lineDrawingHandler.handleFeatureDeselected();
        }
    }
    
    // Clear Riyadh road selection if active
    if (window.currentlySelectedItemType === 'riyadh-road') {
        clearSelectedRiyadhRoad();
    }
}

/**
 * Handle Riyadh road click - show LINE feature sidebar
 */
function handleRiyadhRoadClick(riyadhRoadFeature) {
    // Clear any previously selected item (Riyadh road or TerraDraw line)
    clearPreviousSelection();
    
    // Convert Riyadh road to LINE feature format
    const lineFeatureData = convertRiyadhRoadToLineFeature(riyadhRoadFeature);
    
    if (!lineFeatureData) {
        console.error('Failed to convert Riyadh road to LINE feature');
        return;
    }
    
    // Store the Riyadh road data for editing
    window.selectedRiyadhRoad = lineFeatureData;
    window.currentRiyadhRoadId = lineFeatureData.id;
    
    // Update selection tracking
    window.currentlySelectedItem = lineFeatureData.id;
    window.currentlySelectedItemType = 'riyadh-road';
    
    // Check if line-drawing.js functions are available
    if (typeof window.showRiyadhRoadAsLineFeature === 'function') {
        window.showRiyadhRoadAsLineFeature(lineFeatureData);
    } else if (window.lineDrawingHandler && typeof window.lineDrawingHandler.showRiyadhRoadAsLineFeature === 'function') {
        window.lineDrawingHandler.showRiyadhRoadAsLineFeature(lineFeatureData);
    } else {
        // Fallback: Use approved line display mechanism
        if (window.showApprovedLineDetails && typeof window.showApprovedLineDetails === 'function') {
            window.showApprovedLineDetails(lineFeatureData, true);
        } else {
            // Try after a short delay in case scripts are still loading
            setTimeout(function() {
                handleRiyadhRoadClick(riyadhRoadFeature);
            }, 500);
        }
    }
}

function applyRiyadhRoadsSymbology() {
    if (typeof map === 'undefined' || !map) {
        return;
    }

    if (!map.getLayer('riyadh-roads-layer')) {
        return;
    }

    // We reuse the centralized visualization style function exposed by
    // line-drawing.js. If it's not available yet, we keep existing styling.
    const getStyle = window.getVisualizationStyle;
    if (typeof getStyle !== 'function') {
        return;
    }

    const roadTypes = [
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'residential',
        'living_street',
        'service',
        'track',
        'unclassified',
        'motorway_link',
        'trunk_link',
        'primary_link',
        'secondary_link',
        'tertiary_link'
    ];

    const colorExpression = ['match', ['get', 'fclass']];
    const widthExpression = ['match', ['get', 'fclass']];

    roadTypes.forEach(function (fclass) {
        const label = mapFclassToFeatureLabel(fclass);
        const style = getStyle(label);

        // For the base network, we slightly compress the width range to keep
        // background context subtle relative to selected/edited lines.
        const baseWidth =
            style && typeof style.lineWidth === 'number'
                ? Math.max(0.5, Math.min(style.lineWidth, 6)) * 0.6
                : 0.5;

        const lineColor = style && style.lineColor ? style.lineColor : '#dee2e6';

        colorExpression.push(fclass, lineColor);
        widthExpression.push(fclass, baseWidth);
    });

    colorExpression.push('#dee2e6');
    widthExpression.push(0.5);

    try {
        map.setPaintProperty('riyadh-roads-layer', 'line-color', colorExpression);
        map.setPaintProperty('riyadh-roads-layer', 'line-width', widthExpression);
    } catch (e) {
        // If style is not fully ready, fail silently.
    }
}

// Function to load Riyadh roads from API
async function loadRiyadhRoads() {
    try {
        // Get current map bounds for efficient loading
        const bounds = map.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
        
        // Fetch roads data with bounding box filter
        const response = await fetch(`/mapping/api/riyadh-roads/?bbox=${bbox}&limit=10000`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if we have features
        if (data.features && data.features.length > 0) {
            // Add roads source to map
            if (map.getSource('riyadh-roads')) {
                map.getSource('riyadh-roads').setData(data);
            } else {
                map.addSource('riyadh-roads', {
                    'type': 'geojson',
                    'data': data
                });
            }
            
            // Add roads layer if it doesn't exist
            if (!map.getLayer('riyadh-roads-layer')) {
                map.addLayer({
                    'id': 'riyadh-roads-layer',
                    'type': 'line',
                    'source': 'riyadh-roads',
                    'layout': {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        // Initial neutral styling; replaced by
                        // applyRiyadhRoadsSymbology() once symbology catalog is ready.
                        'line-color': '#dee2e6',
                        'line-width': 0.5,
                        'line-opacity': 0.8
                    }
                });
            }

            // Apply centralized symbology to the Riyadh roads layer
            applyRiyadhRoadsSymbology();
            
            // Riyadh roads loaded successfully
        }
    } catch (error) {
        // Error loading Riyadh roads - silently fail
    }
}

// Map load event
map.on('load', () => {
    // Ensure initial basemap visibility is applied
    setBasemapVisibility(currentBasemapId);

    // Load Riyadh roads after map is loaded
    loadRiyadhRoads();
    
    // Reload roads when map moves/zooms (with debouncing)
    let reloadTimeout;
    map.on('moveend', () => {
        clearTimeout(reloadTimeout);
        reloadTimeout = setTimeout(() => {
            loadRiyadhRoads();
        }, 500); // Wait 500ms after map stops moving
    });
    
    // Add click handler for roads to show LINE feature sidebar (replaces white popup)
    map.on('click', 'riyadh-roads-layer', (e) => {
        e.preventDefault();
        handleRiyadhRoadClick(e.features[0]);
    });
    
    // Change cursor on hover for roads
    map.on('mouseenter', 'riyadh-roads-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    
    map.on('mouseleave', 'riyadh-roads-layer', () => {
        map.getCanvas().style.cursor = '';
    });
    
    // Clear selection when clicking on empty map (not on a feature)
    map.on('click', (e) => {
        // Only clear if clicking on map itself, not on any layer
        // The layer click handlers will prevent this from firing when clicking on features
        const features = map.queryRenderedFeatures(e.point, {
            layers: ['riyadh-roads-layer']
        });
        
        // If no features were clicked, clear selection
        if (features.length === 0) {
            // Check if we should clear (only if clicking outside all selectable features)
            // TerraDraw handles its own deselection, so we just clear Riyadh road selection
            if (window.currentlySelectedItemType === 'riyadh-road') {
                clearSelectedRiyadhRoad();
                window.currentlySelectedItem = null;
                window.currentlySelectedItemType = null;
                
                // Close sidebar if it's open for viewing only (not editing)
                // We don't close it if user is actively editing
                const sidePanel = document.getElementById('editSidePanel');
                const editScreen = document.getElementById('editFeatureScreen');
                if (sidePanel && !editScreen) {
                    // Only close if not in edit mode (viewing mode)
                    const editButton = document.getElementById('editButton');
                    if (editButton && !editButton.classList.contains('active')) {
                        // Check if edit mode is disabled
                        sidePanel.classList.add('-translate-x-full');
                        const mapContainer = document.getElementById('mapContainer');
                        if (mapContainer) {
                            mapContainer.style.marginLeft = '0';
                            mapContainer.style.width = '100%';
                            setTimeout(function() {
                                if (map && map.resize) {
                                    map.resize();
                                }
                            }, 300);
                        }
                    }
                }
            }
        }
    });
});

// Initialize basemap gallery once DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBasemapGallery);
} else {
    initBasemapGallery();
}

// Expose clearSelectedRiyadhRoad globally for use by other scripts
window.clearSelectedRiyadhRoad = clearSelectedRiyadhRoad;
window.clearPreviousSelection = clearPreviousSelection;
