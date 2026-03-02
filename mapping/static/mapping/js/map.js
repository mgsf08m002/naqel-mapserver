// KSA Map Editing Module - JavaScript

// Set bounds to Riyadh, KSA
const bounds = [
    [45.4750000000000014, 23.9810000000000016], // Northeast coordinates
    [48.7329999999999970, 25.6640000000000015] // Southwest coordinates
];

// Initialize map
const map = new maplibregl.Map({
    container: 'map',
    center: [46.727866, 24.723580],
    zoom: 9.5,
    maxZoom: 19,
    maxBounds: bounds,
    style: {
        "version": 8,
        "sources": {
            "satellite": {
                "type": "raster",
                "tiles": [
                    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                    // "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
                ],
                "tileSize": 256,
                "maxzoom": 19,
                "attribution": "Source: Esri, Maxar, Earthstar Geographics"
                // Original: EOX / ESA Sentinel-2 Cloudless 2020
            }
        },
        "layers": [{
            "id": "satellite",
            "type": "raster",
            "source": "satellite"
        }]
    }
});

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

// Mouse move event to display coordinates
map.on('mousemove', (e) => {
    const infoElement = document.getElementById('info');
    if (infoElement) {
        infoElement.innerHTML = JSON.stringify(
            "Screen X: " + e.point.x + 
            ", Screen Y: " + e.point.y + 
            " Lat: " + e.lngLat.lat + 
            ", Long: " + e.lngLat.lng
        );
    }
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

// Expose clearSelectedRiyadhRoad globally for use by other scripts
window.clearSelectedRiyadhRoad = clearSelectedRiyadhRoad;
window.clearPreviousSelection = clearPreviousSelection;
