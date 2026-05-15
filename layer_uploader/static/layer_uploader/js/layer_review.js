/**
 * Layer upload review: basemaps, optional Riyadh roads, approved features on the map,
 * full-screen zoom mode (all features), and row/map selection overlay.
 */
(function () {
    const root = document.getElementById('layer-review-root');
    const mapEl = document.getElementById('review-map');
    if (!root || !mapEl || typeof maplibregl === 'undefined') {
        return;
    }

    const geojsonUrl = root.dataset.geojsonUrl;
    const tableUrl = root.dataset.tableUrl;
    const actionUrl = root.dataset.actionUrl;

    const RIYADH_ROADS_TILE_URL = (root.dataset.riyadhRoadsTileUrl || '').trim();
    const HAS_RIYADH_ROADS_TILES = RIYADH_ROADS_TILE_URL.length > 0;

    const MAPTILER_API_KEY = (root.dataset.maptilerApiKey || '').trim();
    const HAS_MAPTILER = MAPTILER_API_KEY.length > 0;

    const RIYADH_LINE_WIDTH = 3;

    /** Match main map (`mapping/static/mapping/js/map.js`): MapTiler glyphs when key is set. */
    const MAP_GLYPHS_URL = HAS_MAPTILER
        ? 'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=' + MAPTILER_API_KEY
        : 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

    const SOURCE_ID_RIYADH = 'riyadh-roads';
    const PUBLIC_LAYER_ID_RIYADH = 'riyadh-roads-public-layer';
    const SOURCE_LAYER_RIYADH = 'riyadh_roads';
    const SOURCE_UPLOAD = 'lr-upload-approved';
    const SOURCE_ALL = 'lr-review-all-features';
    const SOURCE_SELECTION = 'lr-selection-overlay';
    const UPLOAD_LAYER_IDS = ['lr-lines', 'lr-fill', 'lr-points'];
    const ALL_LAYER_IDS = ['lr-all-lines', 'lr-all-fill', 'lr-all-points'];

    const GEOM_FILTER_LINE = [
        'any',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['geometry-type'], 'MultiLineString'],
    ];
    const GEOM_FILTER_POLY = [
        'any',
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['geometry-type'], 'MultiPolygon'],
    ];
    const GEOM_FILTER_POINT = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']];

    const bounds = [
        [45.475, 23.981],
        [48.733, 25.664],
    ];

    /** Warm neutral road color (matches main map on imagery); works on Satellite, Streets, Outdoor. */
    const RIYADH_ROADS_LINE_COLOR = '#e3d1a3';

    const ICON_APPROVE_SVG =
        '<svg class="lr-action-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
    const ICON_REJECT_SVG =
        '<svg class="lr-action-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    const mapInlineHome = document.getElementById('lr-map-inline-home');
    const mapZoomOverlay = document.getElementById('lr-map-zoom-overlay');
    const mapZoomBody = document.getElementById('lr-map-zoom-body');
    const mapZoomSub = document.getElementById('lr-map-zoom-sub');
    const btnMapOpenZoom = document.getElementById('btn-map-open-zoom');
    const btnMapZoomClose = document.getElementById('btn-map-zoom-close');

    let mapZoomOpen = false;

    function buildBasemapDefinitions() {
        const defs = [
            {
                id: 'esri-satellite',
                label: 'Satellite',
                theme: 'imagery',
                sourceId: 'review-bm-esri',
                layerId: 'review-bm-esri-layer',
                tiles: [
                    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                ],
                attribution: 'Esri, Maxar, Earthstar Geographics',
            },
        ];
        if (HAS_MAPTILER) {
            const mb = 'https://api.maptiler.com/maps';
            const k = MAPTILER_API_KEY;
            defs.push(
                {
                    id: 'maptiler-streets',
                    label: 'Streets',
                    theme: 'light',
                    sourceId: 'review-bm-mt-streets',
                    layerId: 'review-bm-mt-streets-layer',
                    tiles: [mb + '/streets-v2/256/{z}/{x}/{y}.png?key=' + k],
                    attribution: '© MapTiler © OpenStreetMap contributors',
                },
                {
                    id: 'maptiler-outdoor',
                    label: 'Outdoor',
                    theme: 'light',
                    sourceId: 'review-bm-mt-outdoor',
                    layerId: 'review-bm-mt-outdoor-layer',
                    tiles: [mb + '/outdoor-v2/256/{z}/{x}/{y}.png?key=' + k],
                    attribution: '© MapTiler © OpenStreetMap contributors',
                }
            );
        }
        return defs;
    }

    const BASEMAP_DEFINITIONS = buildBasemapDefinitions();
    let currentBasemapId = 'esri-satellite';

    function buildInitialStyle() {
        const sources = {};
        const layers = [];
        BASEMAP_DEFINITIONS.forEach(function (def) {
            sources[def.sourceId] = {
                type: 'raster',
                tiles: def.tiles,
                tileSize: 256,
                maxzoom: 22,
                attribution: def.attribution,
            };
            layers.push({
                id: def.layerId,
                type: 'raster',
                source: def.sourceId,
                layout: {
                    visibility: def.id === currentBasemapId ? 'visible' : 'none',
                },
                minzoom: 0,
                maxzoom: 22,
            });
        });
        return {
            version: 8,
            glyphs: MAP_GLYPHS_URL,
            sources: sources,
            layers: layers,
        };
    }

    const map = new maplibregl.Map({
        container: 'review-map',
        center: [46.727866, 24.72358],
        zoom: 9.5,
        maxZoom: 19,
        maxBounds: bounds,
        style: buildInitialStyle(),
    });

    map.addControl(
        new maplibregl.NavigationControl({
            visualizePitch: false,
            visualizeRoll: false,
            showZoom: true,
            showCompass: true,
        })
    );

    function overlayPalette(theme) {
        if (theme === 'imagery') {
            return {
                riyadh: RIYADH_ROADS_LINE_COLOR,
                approved: '#e8e8e8',
                selHalo: '#ffffff',
                selCore: '#141414',
                fillOutline: '#ffffff',
                pointStroke: '#ffffff',
            };
        }
        return {
            riyadh: RIYADH_ROADS_LINE_COLOR,
            approved: '#525252',
            selHalo: '#ffffff',
            selCore: '#0a0a0a',
            fillOutline: '#525252',
            pointStroke: '#fafafa',
        };
    }

    function themeForBasemapId(basemapId) {
        const def = BASEMAP_DEFINITIONS.find(function (d) {
            return d.id === basemapId;
        });
        return def && def.theme ? def.theme : 'light';
    }

    function applyOverlayThemeForBasemap(basemapId) {
        const pal = overlayPalette(themeForBasemapId(basemapId));
        try {
            if (map.getLayer(PUBLIC_LAYER_ID_RIYADH)) {
                map.setPaintProperty(PUBLIC_LAYER_ID_RIYADH, 'line-color', pal.riyadh);
            }
            if (map.getLayer('lr-lines')) {
                map.setPaintProperty('lr-lines', 'line-color', pal.approved);
            }
            if (map.getLayer('lr-fill')) {
                map.setPaintProperty('lr-fill', 'fill-color', pal.approved);
                map.setPaintProperty('lr-fill', 'fill-outline-color', pal.approved);
            }
            if (map.getLayer('lr-points')) {
                map.setPaintProperty('lr-points', 'circle-color', pal.approved);
                map.setPaintProperty('lr-points', 'circle-stroke-color', pal.pointStroke);
            }
            if (map.getLayer('lr-sel-fill')) {
                map.setPaintProperty('lr-sel-fill', 'fill-color', pal.selCore);
                map.setPaintProperty('lr-sel-fill', 'fill-outline-color', pal.fillOutline);
            }
            if (map.getLayer('lr-sel-line-halo')) {
                map.setPaintProperty('lr-sel-line-halo', 'line-color', pal.selHalo);
            }
            if (map.getLayer('lr-sel-line-core')) {
                map.setPaintProperty('lr-sel-line-core', 'line-color', pal.selCore);
            }
            if (map.getLayer('lr-sel-points-halo')) {
                map.setPaintProperty('lr-sel-points-halo', 'circle-color', pal.selHalo);
            }
            if (map.getLayer('lr-sel-points-core')) {
                map.setPaintProperty('lr-sel-points-core', 'circle-color', pal.selCore);
                map.setPaintProperty('lr-sel-points-core', 'circle-stroke-color', pal.selHalo);
            }
        } catch (e) {
            /* ignore missing layers during startup */
        }
    }

    function setBasemap(basemapId) {
        const ok = BASEMAP_DEFINITIONS.some(function (d) {
            return d.id === basemapId;
        });
        if (!ok) {
            return;
        }
        currentBasemapId = basemapId;
        BASEMAP_DEFINITIONS.forEach(function (def) {
            if (!map.getLayer(def.layerId)) {
                return;
            }
            map.setLayoutProperty(def.layerId, 'visibility', def.id === basemapId ? 'visible' : 'none');
        });
        applyOverlayThemeForBasemap(basemapId);
        syncBasemapButtons();
    }

    function syncBasemapButtons() {
        document.querySelectorAll('[data-review-basemap-id]').forEach(function (btn) {
            const id = btn.getAttribute('data-review-basemap-id');
            const on = id === currentBasemapId;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.classList.toggle('lr-basemap-opt--active', on);
        });
    }

    function initBasemapControls() {
        const strip = document.getElementById('review-basemap-strip');
        if (!strip) {
            return;
        }
        strip.innerHTML = '';
        BASEMAP_DEFINITIONS.forEach(function (def) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lr-basemap-opt';
            btn.setAttribute('data-review-basemap-id', def.id);
            btn.setAttribute('aria-pressed', def.id === currentBasemapId ? 'true' : 'false');
            btn.setAttribute('title', def.label);
            btn.textContent = def.label;
            btn.addEventListener('click', function () {
                setBasemap(def.id);
            });
            strip.appendChild(btn);
        });
        syncBasemapButtons();
    }

    let selectedFeatureId = null;
    const featureGeomById = {};

    function buildCacheBustedUrl(baseUrl) {
        if (!baseUrl) {
            return baseUrl;
        }
        const sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
        return baseUrl + sep + 'v=' + encodeURIComponent(String(Date.now()));
    }

    function ensureRiyadhRoadsSource() {
        if (!HAS_RIYADH_ROADS_TILES || map.getSource(SOURCE_ID_RIYADH)) {
            return;
        }
        const bustedUrl = buildCacheBustedUrl(RIYADH_ROADS_TILE_URL);
        const promote = {};
        promote[SOURCE_LAYER_RIYADH] = 'id';
        map.addSource(SOURCE_ID_RIYADH, {
            type: 'vector',
            tiles: [bustedUrl],
            minzoom: 0,
            maxzoom: 14,
            promoteId: promote,
        });
    }

    function addRiyadhPublicRoadLayer() {
        if (!HAS_RIYADH_ROADS_TILES || map.getLayer(PUBLIC_LAYER_ID_RIYADH)) {
            return;
        }
        map.addLayer({
            id: PUBLIC_LAYER_ID_RIYADH,
            type: 'line',
            source: SOURCE_ID_RIYADH,
            'source-layer': SOURCE_LAYER_RIYADH,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': RIYADH_ROADS_LINE_COLOR,
                'line-width': RIYADH_LINE_WIDTH,
                'line-opacity': 1,
            },
        });
    }

    function boundsFromGeometry(geom) {
        if (!geom || !geom.coordinates) {
            return null;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        function scan(coords) {
            if (!coords) {
                return;
            }
            if (typeof coords[0] === 'number') {
                const lng = coords[0];
                const lat = coords[1];
                minX = Math.min(minX, lng);
                maxX = Math.max(maxX, lng);
                minY = Math.min(minY, lat);
                maxY = Math.max(maxY, lat);
                return;
            }
            for (let i = 0; i < coords.length; i += 1) {
                scan(coords[i]);
            }
        }

        scan(geom.coordinates);
        if (!isFinite(minX) || !isFinite(minY)) {
            return null;
        }
        return [
            [minX, minY],
            [maxX, maxY],
        ];
    }

    function padBounds(bb, padDeg) {
        const p = padDeg || 0.0015;
        return [
            [bb[0][0] - p, bb[0][1] - p],
            [bb[1][0] + p, bb[1][1] + p],
        ];
    }

    function boundsArea(bb) {
        if (!bb || bb.length !== 2) {
            return 0;
        }
        const dx = bb[1][0] - bb[0][0];
        const dy = bb[1][1] - bb[0][1];
        return Math.abs(dx * dy);
    }

    function resizeMapSoon(afterResize) {
        requestAnimationFrame(function () {
            map.resize();
            if (typeof afterResize === 'function') {
                afterResize();
            }
        });
    }

    function rowRefFromTr(tr) {
        if (!tr) {
            return null;
        }
        const fid = parseInt(tr.dataset.featureId, 10);
        let bbox;
        let center;
        if (tr.dataset.bboxEnc && tr.dataset.centerEnc) {
            try {
                bbox = JSON.parse(decodeURIComponent(tr.dataset.bboxEnc));
                center = JSON.parse(decodeURIComponent(tr.dataset.centerEnc));
            } catch (e) {
                /* ignore */
            }
        }
        return { bbox: bbox, center: center, geometry: featureGeomById[fid] };
    }

    function activeFeatureLayerIds() {
        const ids = mapZoomOpen ? ALL_LAYER_IDS : UPLOAD_LAYER_IDS;
        return ids.filter(function (id) {
            return map.getLayer(id);
        });
    }

    function focusFeatureFromMapClick(e) {
        const layers = activeFeatureLayerIds();
        if (!layers.length) {
            return;
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: layers });
        if (!hits.length) {
            return;
        }
        const props = hits[0].properties || {};
        const fid =
            props.upload_feature_id != null ? parseInt(String(props.upload_feature_id), 10) : NaN;
        if (Number.isNaN(fid)) {
            return;
        }
        const tr = document.querySelector(
            '#review-feature-rows tr[data-feature-id="' + String(fid) + '"]'
        );
        const ref = rowRefFromTr(tr);
        if (ref) {
            focusFeature(fid, ref);
        }
    }

    function mergeBounds(bbList) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        bbList.forEach(function (bb) {
            if (!bb || bb.length !== 2) {
                return;
            }
            minX = Math.min(minX, bb[0][0]);
            minY = Math.min(minY, bb[0][1]);
            maxX = Math.max(maxX, bb[1][0]);
            maxY = Math.max(maxY, bb[1][1]);
        });
        if (!isFinite(minX)) {
            return null;
        }
        return [
            [minX, minY],
            [maxX, maxY],
        ];
    }

    function buildAllFeaturesCollection() {
        const features = [];
        Object.keys(featureGeomById).forEach(function (k) {
            const fid = parseInt(k, 10);
            const geom = featureGeomById[fid];
            if (!geom) {
                return;
            }
            features.push({
                type: 'Feature',
                id: fid,
                geometry: geom,
                properties: { upload_feature_id: fid },
            });
        });
        return { type: 'FeatureCollection', features: features };
    }

    function setLayerGroupVisibility(layerIds, visible) {
        const vis = visible ? 'visible' : 'none';
        layerIds.forEach(function (layerId) {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', vis);
            }
        });
    }

    function ensureAllFeaturesSourceAndLayers() {
        const data = buildAllFeaturesCollection();
        const beforeId = map.getLayer('lr-sel-fill') ? 'lr-sel-fill' : undefined;
        if (!map.getSource(SOURCE_ALL)) {
            map.addSource(SOURCE_ALL, {
                type: 'geojson',
                data: data,
                promoteId: 'upload_feature_id',
            });
            map.addLayer(
                {
                    id: 'lr-all-fill',
                    type: 'fill',
                    source: SOURCE_ALL,
                    filter: GEOM_FILTER_POLY,
                    layout: { visibility: 'none' },
                    paint: {
                        'fill-color': '#a3a3a3',
                        'fill-opacity': 0.18,
                        'fill-outline-color': '#737373',
                    },
                },
                beforeId
            );
            map.addLayer(
                {
                    id: 'lr-all-lines',
                    type: 'line',
                    source: SOURCE_ALL,
                    filter: GEOM_FILTER_LINE,
                    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': '#737373',
                        'line-width': 3,
                        'line-opacity': 0.9,
                    },
                },
                beforeId
            );
            map.addLayer(
                {
                    id: 'lr-all-points',
                    type: 'circle',
                    source: SOURCE_ALL,
                    filter: GEOM_FILTER_POINT,
                    layout: { visibility: 'none' },
                    paint: {
                        'circle-radius': 5,
                        'circle-color': '#737373',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#fafafa',
                    },
                },
                beforeId
            );
            bindFeatureLayerHandlers();
        } else {
            map.getSource(SOURCE_ALL).setData(data);
        }
    }

    function syncMapFeatureLayers() {
        if (!map.isStyleLoaded()) {
            return;
        }
        ensureAllFeaturesSourceAndLayers();
        setLayerGroupVisibility(UPLOAD_LAYER_IDS, !mapZoomOpen);
        setLayerGroupVisibility(ALL_LAYER_IDS, mapZoomOpen);
    }

    function zoomToAllFeatures() {
        const bbList = [];
        Object.keys(featureGeomById).forEach(function (k) {
            const bb = boundsFromGeometry(featureGeomById[k]);
            if (bb) {
                bbList.push(bb);
            }
        });
        const merged = mergeBounds(bbList);
        if (!merged) {
            return;
        }
        const padded = boundsArea(merged) < 1e-12 ? padBounds(merged, 0.01) : merged;
        try {
            map.fitBounds(new maplibregl.LngLatBounds(padded[0], padded[1]), {
                padding: { top: 80, bottom: 80, left: 80, right: 80 },
                maxZoom: 16,
                duration: 900,
            });
        } catch (e) {
            /* ignore */
        }
    }

    function updateZoomModalSubtitle() {
        if (!mapZoomSub) {
            return;
        }
        if (!mapZoomOpen) {
            return;
        }
        if (selectedFeatureId != null && featureGeomById[selectedFeatureId]) {
            mapZoomSub.textContent =
                'Focused on feature #' + String(selectedFeatureId) + '. Select another row to refocus.';
            return;
        }
        mapZoomSub.textContent = 'All features are shown. Select a row in the table to focus the map.';
    }

    function openMapZoomModal() {
        if (!mapZoomOverlay || !mapZoomBody || !mapInlineHome || mapZoomOpen) {
            return;
        }
        mapZoomBody.appendChild(mapEl);
        mapZoomOverlay.hidden = false;
        mapZoomOverlay.setAttribute('aria-hidden', 'false');
        mapZoomOpen = true;
        document.body.style.overflow = 'hidden';
        syncMapFeatureLayers();
        updateZoomModalSubtitle();
        resizeMapSoon(zoomToAllFeatures);
    }

    function closeMapZoomModal() {
        if (!mapZoomOverlay || !mapInlineHome || !mapZoomOpen) {
            return;
        }
        mapInlineHome.appendChild(mapEl);
        mapZoomOverlay.hidden = true;
        mapZoomOverlay.setAttribute('aria-hidden', 'true');
        mapZoomOpen = false;
        document.body.style.overflow = '';
        syncMapFeatureLayers();
        resizeMapSoon();
    }

    function focusFeature(fid, rowRef) {
        setRowSelected(fid);
        zoomToFeature(rowRef);
        if (!mapZoomOpen) {
            mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function zoomToFeature(row) {
        let bb = row.bbox;
        const center = row.center;
        const geom = row.geometry;
        const fitPadding = mapZoomOpen
            ? { top: 96, bottom: 96, left: 96, right: 96 }
            : { top: 72, bottom: 72, left: 72, right: 72 };

        if (!bb || !Array.isArray(bb) || bb.length !== 2) {
            bb = geom ? boundsFromGeometry(geom) : null;
        }

        if (bb && boundsArea(bb) < 1e-10) {
            bb = padBounds(bb, 0.002);
        }

        if (center && Array.isArray(center) && center.length === 2 && (!bb || boundsArea(bb) < 1e-16)) {
            map.easeTo({ center: center, zoom: mapZoomOpen ? 18 : 17, duration: 750 });
            return;
        }

        if (bb && bb.length === 2) {
            try {
                const lngLatBounds = new maplibregl.LngLatBounds(bb[0], bb[1]);
                map.fitBounds(lngLatBounds, {
                    padding: fitPadding,
                    maxZoom: 18,
                    duration: 850,
                });
            } catch (e) {
                if (center && center.length === 2) {
                    map.easeTo({ center: center, zoom: 17, duration: 750 });
                }
            }
            return;
        }

        if (geom) {
            const fromGeom = boundsFromGeometry(geom);
            if (fromGeom) {
                const padded = boundsArea(fromGeom) < 1e-12 ? padBounds(fromGeom, 0.003) : fromGeom;
                try {
                    map.fitBounds(new maplibregl.LngLatBounds(padded[0], padded[1]), {
                        padding: 64,
                        maxZoom: 18,
                        duration: 850,
                    });
                } catch (e2) {
                    /* ignore */
                }
            }
        }
    }

    function ensureSelectionSourceAndLayers() {
        if (map.getSource(SOURCE_SELECTION)) {
            return;
        }
        map.addSource(SOURCE_SELECTION, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
            id: 'lr-sel-fill',
            type: 'fill',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_POLY,
            paint: {
                'fill-color': '#0a0a0a',
                'fill-opacity': 0.22,
                'fill-outline-color': '#ffffff',
            },
        });
        map.addLayer({
            id: 'lr-sel-line-halo',
            type: 'line',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_LINE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#ffffff',
                'line-width': 12,
                'line-opacity': 1,
            },
        });
        map.addLayer({
            id: 'lr-sel-line-core',
            type: 'line',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_LINE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#0a0a0a',
                'line-width': 5,
                'line-opacity': 1,
            },
        });
        map.addLayer({
            id: 'lr-sel-points-halo',
            type: 'circle',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_POINT,
            paint: {
                'circle-radius': 14,
                'circle-color': '#ffffff',
                'circle-opacity': 1,
            },
        });
        map.addLayer({
            id: 'lr-sel-points-core',
            type: 'circle',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_POINT,
            paint: {
                'circle-radius': 7,
                'circle-color': '#0a0a0a',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
            },
        });
        applyOverlayThemeForBasemap(currentBasemapId);
    }

    function setSelectionHighlight(fid) {
        ensureSelectionSourceAndLayers();
        const src = map.getSource(SOURCE_SELECTION);
        if (!src) {
            return;
        }
        if (fid == null || fid < 0 || !featureGeomById[fid]) {
            src.setData({ type: 'FeatureCollection', features: [] });
            return;
        }
        const g = featureGeomById[fid];
        src.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: g,
                    properties: { upload_feature_id: fid },
                },
            ],
        });
    }

    function addUploadOverlayLayers() {
        if (!map.getSource(SOURCE_UPLOAD)) {
            return;
        }

        if (!map.getLayer('lr-lines')) {
            map.addLayer({
                id: 'lr-lines',
                type: 'line',
                source: SOURCE_UPLOAD,
                filter: GEOM_FILTER_LINE,
                paint: {
                    'line-color': '#525252',
                    'line-width': 4,
                    'line-opacity': 0.95,
                },
            });
        }
        if (!map.getLayer('lr-fill')) {
            map.addLayer({
                id: 'lr-fill',
                type: 'fill',
                source: SOURCE_UPLOAD,
                filter: GEOM_FILTER_POLY,
                paint: {
                    'fill-color': '#525252',
                    'fill-opacity': 0.1,
                    'fill-outline-color': '#525252',
                },
            });
        }
        if (!map.getLayer('lr-points')) {
            map.addLayer({
                id: 'lr-points',
                type: 'circle',
                source: SOURCE_UPLOAD,
                filter: GEOM_FILTER_POINT,
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#525252',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fafafa',
                },
            });
        }
        bindFeatureLayerHandlers();

        if (HAS_RIYADH_ROADS_TILES && map.getLayer(PUBLIC_LAYER_ID_RIYADH)) {
            const anchorId = UPLOAD_LAYER_IDS.find(function (id) {
                return map.getLayer(id);
            });
            if (anchorId) {
                try {
                    map.moveLayer(PUBLIC_LAYER_ID_RIYADH, anchorId);
                } catch (eMove) {
                    /* ignore */
                }
            }
        }
    }

    const boundFeatureLayerHandlers = {};

    function bindFeatureLayerHandlers() {
        UPLOAD_LAYER_IDS.concat(ALL_LAYER_IDS).forEach(function (layerId) {
            if (!map.getLayer(layerId) || boundFeatureLayerHandlers[layerId]) {
                return;
            }
            boundFeatureLayerHandlers[layerId] = true;
            map.on('mouseenter', layerId, function () {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layerId, function () {
                map.getCanvas().style.cursor = '';
            });
        });
    }

    function setUploadSourceData(data) {
        if (!map.getSource(SOURCE_UPLOAD)) {
            map.addSource(SOURCE_UPLOAD, {
                type: 'geojson',
                data: data,
                promoteId: 'upload_feature_id',
            });
            addUploadOverlayLayers();
        } else {
            map.getSource(SOURCE_UPLOAD).setData(data);
        }
    }

    function setRowSelected(fid) {
        selectedFeatureId = fid;
        const rows = document.querySelectorAll('#review-feature-rows tr[data-feature-id]');
        rows.forEach(function (tr) {
            const id = parseInt(tr.getAttribute('data-feature-id'), 10);
            const on = id === fid;
            tr.classList.toggle('lr-row-selected', on);
            if (on) {
                tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });
        setSelectionHighlight(fid);
        updateZoomModalSubtitle();
    }

    function getCsrfToken() {
        const input = document.querySelector('[name=csrfmiddlewaretoken]');
        if (input && input.value) {
            return input.value;
        }
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function postAction(payload) {
        return fetch(actionUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
        }).then(function (r) {
            if (!r.ok) {
                const ct = r.headers.get('content-type') || '';
                if (ct.indexOf('application/json') >= 0) {
                    return r.json().then(function (j) {
                        throw new Error(j.detail || r.statusText);
                    });
                }
                throw new Error(r.status === 403 ? 'Access denied' : r.statusText);
            }
            return r.json();
        });
    }

    function fetchReviewJson(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) {
                throw new Error(r.status === 403 ? 'Access denied' : 'Request failed');
            }
            return r.json();
        });
    }

    function renderCounts(counts) {
        const p = document.getElementById('cnt-pending');
        const a = document.getElementById('cnt-approved');
        const r = document.getElementById('cnt-rejected');
        if (p) {
            p.textContent = counts.pending != null ? String(counts.pending) : '0';
        }
        if (a) {
            a.textContent = counts.approved != null ? String(counts.approved) : '0';
        }
        if (r) {
            r.textContent = counts.rejected != null ? String(counts.rejected) : '0';
        }
    }

    function statusBadge(status) {
        if (status === 'approved') {
            return '<span class="lr-badge lr-badge-approved">Approved</span>';
        }
        if (status === 'rejected') {
            return '<span class="lr-badge lr-badge-rejected">Rejected</span>';
        }
        return '<span class="lr-badge lr-badge-pending">Pending</span>';
    }

    function renderPropertiesCell(f) {
        const entries = f.property_entries;
        if (!entries || !entries.length) {
            return '<span class="lr-prop-fallback">—</span>';
        }
        const rows = entries
            .map(function (e) {
                return (
                    '<div class="lr-prop-row"><span class="lr-prop-key">' +
                    escapeHtml(String(e.key)) +
                    '</span><span class="lr-prop-val">' +
                    escapeHtml(String(e.value)) +
                    '</span></div>'
                );
            })
            .join('');
        return '<div class="lr-prop-list">' + rows + '</div>';
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function renderTable(payload) {
        const tbody = document.getElementById('review-feature-rows');
        if (!tbody) {
            return;
        }
        renderCounts(payload.counts || {});

        Object.keys(featureGeomById).forEach(function (k) {
            delete featureGeomById[k];
        });

        const feats = payload.features || [];
        tbody.innerHTML = '';
        if (!feats.length) {
            tbody.innerHTML =
                '<tr><td colspan="4" class="lr-empty">No new features were found for this upload. You can still finish.</td></tr>';
            syncMapFeatureLayers();
            return;
        }

        feats.forEach(function (f) {
            if (f.geometry) {
                featureGeomById[f.id] = f.geometry;
            }
        });

        feats.forEach(function (f, idx) {
            const tr = document.createElement('tr');
            tr.className = 'lr-table-row';
            tr.dataset.featureId = String(f.id);
            tr.dataset.bboxEnc = encodeURIComponent(JSON.stringify(f.bbox));
            tr.dataset.centerEnc = encodeURIComponent(JSON.stringify(f.center));

            const tdNum = document.createElement('td');
            tdNum.className = 'lr-td-num';
            tdNum.textContent = String(idx + 1);

            const tdSt = document.createElement('td');
            tdSt.className = 'lr-td-status';
            tdSt.innerHTML = statusBadge(f.status);

            const tdProps = document.createElement('td');
            tdProps.className = 'lr-td-props';
            tdProps.innerHTML = renderPropertiesCell(f);

            const tdAct = document.createElement('td');
            tdAct.className = 'lr-td-actions';
            const bA = document.createElement('button');
            bA.type = 'button';
            bA.className = 'lr-action-btn lr-action-btn--approve';
            bA.dataset.fid = String(f.id);
            bA.setAttribute('aria-label', 'Approve feature');
            bA.setAttribute('title', 'Approve');
            bA.innerHTML = ICON_APPROVE_SVG;
            const bR = document.createElement('button');
            bR.type = 'button';
            bR.className = 'lr-action-btn lr-action-btn--reject';
            bR.dataset.fid = String(f.id);
            bR.setAttribute('aria-label', 'Reject feature');
            bR.setAttribute('title', 'Reject');
            bR.innerHTML = ICON_REJECT_SVG;
            tdAct.appendChild(bA);
            tdAct.appendChild(bR);

            tr.appendChild(tdNum);
            tr.appendChild(tdSt);
            tr.appendChild(tdProps);
            tr.appendChild(tdAct);

            const rowRef = {
                bbox: f.bbox,
                center: f.center,
                geometry: f.geometry,
            };

            tr.addEventListener('click', function (e) {
                if (e.target.closest('.lr-action-btn')) {
                    return;
                }
                const fid = parseInt(tr.dataset.featureId, 10);
                focusFeature(fid, rowRef);
            });

            bA.addEventListener('click', function (e) {
                e.stopPropagation();
                const fid = parseInt(bA.dataset.fid, 10);
                postAction({ action: 'approve', feature_id: fid })
                    .then(function () {
                        return refreshAll();
                    })
                    .catch(function (err) {
                        window.alert(err.message || 'Approve failed');
                    });
            });
            bR.addEventListener('click', function (e) {
                e.stopPropagation();
                const fid = parseInt(bR.dataset.fid, 10);
                postAction({ action: 'reject', feature_id: fid })
                    .then(function () {
                        return refreshAll();
                    })
                    .catch(function (err) {
                        window.alert(err.message || 'Reject failed');
                    });
            });

            tbody.appendChild(tr);
        });

        const restore = selectedFeatureId;
        if (restore != null && featureGeomById[restore]) {
            setRowSelected(restore);
            const trRestore = document.querySelector(
                '#review-feature-rows tr[data-feature-id="' + String(restore) + '"]'
            );
            const refRestore = rowRefFromTr(trRestore);
            if (refRestore) {
                zoomToFeature(refRestore);
            }
        } else {
            selectedFeatureId = null;
            document.querySelectorAll('.lr-table-row.lr-row-selected').forEach(function (el) {
                el.classList.remove('lr-row-selected');
            });
            setSelectionHighlight(null);
        }

        syncMapFeatureLayers();
    }

    function refreshAll() {
        return Promise.all([fetchReviewJson(geojsonUrl), fetchReviewJson(tableUrl)])
            .then(function (results) {
                setUploadSourceData(results[0]);
                renderTable(results[1]);
                applyOverlayThemeForBasemap(currentBasemapId);
            })
            .catch(function () {
                window.alert('Failed to refresh data.');
            });
    }

    map.on('load', function () {
        initBasemapControls();
        ensureRiyadhRoadsSource();
        addRiyadhPublicRoadLayer();

        if (btnMapOpenZoom) {
            btnMapOpenZoom.addEventListener('click', openMapZoomModal);
        }
        if (btnMapZoomClose) {
            btnMapZoomClose.addEventListener('click', closeMapZoomModal);
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && mapZoomOpen) {
                closeMapZoomModal();
            }
        });

        map.on('click', focusFeatureFromMapClick);

        refreshAll().then(function () {
            setTimeout(function () {
                map.resize();
            }, 50);
        });
    });

    const btnAllA = document.getElementById('btn-approve-all');
    const btnAllR = document.getElementById('btn-reject-all');
    if (btnAllA) {
        btnAllA.addEventListener('click', function () {
            postAction({ action: 'approve_all' })
                .then(function () {
                    return refreshAll();
                })
                .catch(function (err) {
                    window.alert(err.message || 'Bulk approve failed');
                });
        });
    }
    if (btnAllR) {
        btnAllR.addEventListener('click', function () {
            postAction({ action: 'reject_all' })
                .then(function () {
                    return refreshAll();
                })
                .catch(function (err) {
                    window.alert(err.message || 'Bulk reject failed');
                });
        });
    }
})();
