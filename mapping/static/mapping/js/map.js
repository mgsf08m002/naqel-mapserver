// KSA Map Editing Module - JavaScript

// Sample GeoJSON data
const myData = {
    "type": "FeatureCollection",
    "features": [
        {
            "id": "ec934c5b-ac89-4e03-8b3e-79e24d03e7e1",
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [46.64740553, 24.761051117],
                        [46.668541852, 24.769756188],
                        [46.676846984, 24.753236602],
                        [46.655570029, 24.744473149],
                        [46.64740553, 24.761051117]
                    ]
                ]
            },
            "properties": {
                "name": "Al Muruj"
            }
        },
        {
            "id": "a235c852-6715-4f9a-9f71-161d62e5f1c6",
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [46.686477576, 24.777352493],
                        [46.704590674, 24.784892852],
                        [46.712737615, 24.768518919],
                        [46.694861809, 24.761049389],
                        [46.690669692, 24.769093479],
                        [46.686477576, 24.777352493]
                    ]
                ]
            },
            "properties": {
                "name": "At Taawun"
            }
        },
        {
            "id": "4b290ec3-1fa5-4d4e-9898-cac41a249739",
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [46.676891252, 24.753213189],
                        [46.694876436, 24.760954457],
                        [46.703193284, 24.744102419],
                        [46.685221092, 24.736560742],
                        [46.676891252, 24.753213189]
                    ]
                ]
            },
            "properties": {
                "name": "Al Mursalat"
            }
        },
        {
            "id": "ffe99343-a5ec-4f89-8e03-1ba653a1fdde",
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [46.712789139, 24.768470629],
                        [46.730826302, 24.776069362],
                        [46.738831269, 24.759738593],
                        [46.721209946, 24.751666812],
                        [46.712789139, 24.768470629]
                    ]
                ]
            },
            "properties": {
                "name": "Al Mughrizat"
            }
        }
    ]
};

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

if (drawInstance) {
    drawInstance.on('select', (id) => {
        const snapshot = drawInstance.getSnapshot();
        const features = snapshot?.find((feature) => feature.id === id);
        selectedFeature = JSON.stringify(features);
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
                        'line-color': [
                            'match',
                            ['get', 'fclass'],
                            'motorway', '#ff6b6b',
                            'trunk', '#ff8787',
                            'primary', '#ffa8a8',
                            'secondary', '#ffc9c9',
                            'tertiary', '#ffe0e0',
                            'residential', '#f1f3f5',
                            '#dee2e6' // default color
                        ],
                        'line-width': [
                            'match',
                            ['get', 'fclass'],
                            'motorway', 3,
                            'trunk', 2.5,
                            'primary', 2,
                            'secondary', 1.5,
                            'tertiary', 1,
                            'residential', 0.5,
                            0.5 // default width
                        ],
                        'line-opacity': 0.8
                    }
                });
            }
            
            console.log(`Loaded ${data.count || data.features.length} Riyadh road segments`);
        }
    } catch (error) {
        console.error('Error loading Riyadh roads:', error);
        // Don't show error to user, just log it
    }
}

// Map load event to add GeoJSON layer
map.on('load', () => {
    map.addSource('maine', {
        'type': 'geojson',
        'data': myData,
    });

    map.addLayer({
        'id': 'maine',
        'type': 'fill',
        'source': 'maine',
        'layout': {},
        'paint': {
            'fill-color': '#088',
            'fill-opacity': 0.8
        }
    });

    // When a click event occurs on a feature in the states layer, open a popup at the
    // location of the click, with description HTML from its properties.
    map.on('click', 'maine', (e) => {
        new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(e.features[0].properties.name)
            .addTo(map);
    });

    // Change the cursor to a pointer when the mouse is over the states layer.
    map.on('mouseenter', 'maine', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    // Change it back to a pointer when it leaves.
    map.on('mouseleave', 'maine', () => {
        map.getCanvas().style.cursor = '';
    });
    
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
    
    // Add click handler for roads to show popup with road info
    map.on('click', 'riyadh-roads-layer', (e) => {
        const props = e.features[0].properties;
        const popupContent = `
            <div style="padding: 5px;">
                <strong>${props.name || 'Unnamed Road'}</strong><br>
                ${props.fclass ? `<small>Type: ${props.fclass}</small><br>` : ''}
                ${props.ref ? `<small>Ref: ${props.ref}</small><br>` : ''}
                ${props.maxspeed ? `<small>Speed Limit: ${props.maxspeed} km/h</small><br>` : ''}
                ${props.oneway === 'Y' ? `<small>One-way</small>` : ''}
            </div>
        `;
        new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(popupContent)
            .addTo(map);
    });
    
    // Change cursor on hover for roads
    map.on('mouseenter', 'riyadh-roads-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    
    map.on('mouseleave', 'riyadh-roads-layer', () => {
        map.getCanvas().style.cursor = '';
    });
});

