/**
 * Layer upload review: selectable raster basemaps, Riyadh MVT roads, approved GeoJSON,
 * and a selection overlay (pending rows use geometry from the review table API).
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

    const MAP_GLYPHS_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

    const SOURCE_ID_RIYADH = 'riyadh-roads';
    const PUBLIC_LAYER_ID_RIYADH = 'riyadh-roads-public-layer';
    const SOURCE_LAYER_RIYADH = 'riyadh_roads';
    const SOURCE_UPLOAD = 'lr-upload-approved';
    const SOURCE_SELECTION = 'lr-selection-overlay';

    const bounds = [
        [45.475, 23.981],
        [48.733, 25.664],
    ];

    function buildBasemapDefinitions() {
        const defs = [
            {
                id: 'carto-light',
                label: 'Light',
                theme: 'light',
                sourceId: 'review-bm-carto-light',
                layerId: 'review-bm-carto-light-layer',
                tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
                attribution: '© OpenStreetMap © CARTO',
            },
            {
                id: 'carto-dark',
                label: 'Dark',
                theme: 'dark',
                sourceId: 'review-bm-carto-dark',
                layerId: 'review-bm-carto-dark-layer',
                tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
                attribution: '© OpenStreetMap © CARTO',
            },
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
                },
                {
                    id: 'maptiler-dark',
                    label: 'Midnight',
                    theme: 'dark',
                    sourceId: 'review-bm-mt-dark',
                    layerId: 'review-bm-mt-dark-layer',
                    tiles: [mb + '/darkmatter/256/{z}/{x}/{y}.png?key=' + k],
                    attribution: '© MapTiler © OpenStreetMap contributors',
                }
            );
        }
        return defs;
    }

    const BASEMAP_DEFINITIONS = buildBasemapDefinitions();
    let currentBasemapId = 'carto-light';

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
        if (theme === 'dark') {
            return {
                riyadh: '#ececec',
                approved: '#b0b0b0',
                selHalo: '#121212',
                selCore: '#fafafa',
                fillOutline: '#fafafa',
                pointStroke: '#121212',
            };
        }
        if (theme === 'imagery') {
            return {
                riyadh: '#f5e6b8',
                approved: '#e8e8e8',
                selHalo: '#ffffff',
                selCore: '#141414',
                fillOutline: '#ffffff',
                pointStroke: '#ffffff',
            };
        }
        return {
            riyadh: '#1a1a1a',
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
                'line-color': '#1a1a1a',
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

    function zoomToFeature(row) {
        let bb = row.bbox;
        const center = row.center;
        const geom = row.geometry;

        if (!bb || !Array.isArray(bb) || bb.length !== 2) {
            bb = geom ? boundsFromGeometry(geom) : null;
        }

        if (bb && (boundsArea(bb) < 1e-14 || boundsArea(bb) < 1e-10)) {
            bb = padBounds(bb, 0.002);
        }

        if (center && Array.isArray(center) && center.length === 2 && (!bb || boundsArea(bb) < 1e-16)) {
            map.easeTo({ center: center, zoom: 17, duration: 750 });
            return;
        }

        if (bb && bb.length === 2) {
            try {
                const lngLatBounds = new maplibregl.LngLatBounds(bb[0], bb[1]);
                map.fitBounds(lngLatBounds, {
                    padding: { top: 72, bottom: 72, left: 72, right: 72 },
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

        const lineFilter = [
            'any',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['geometry-type'], 'MultiLineString'],
        ];
        const polyFilter = [
            'any',
            ['==', ['geometry-type'], 'Polygon'],
            ['==', ['geometry-type'], 'MultiPolygon'],
        ];
        const pointFilter = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']];

        map.addLayer({
            id: 'lr-sel-fill',
            type: 'fill',
            source: SOURCE_SELECTION,
            filter: polyFilter,
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
            filter: lineFilter,
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
            filter: lineFilter,
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
            filter: pointFilter,
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
            filter: pointFilter,
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
        const lineFilter = [
            'any',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['geometry-type'], 'MultiLineString'],
        ];
        const polyFilter = [
            'any',
            ['==', ['geometry-type'], 'Polygon'],
            ['==', ['geometry-type'], 'MultiPolygon'],
        ];
        const pointFilter = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']];

        if (!map.getLayer('lr-lines')) {
            map.addLayer({
                id: 'lr-lines',
                type: 'line',
                source: SOURCE_UPLOAD,
                filter: lineFilter,
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
                filter: polyFilter,
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
                filter: pointFilter,
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#525252',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fafafa',
                },
            });
        }
        bindUploadFeatureHoverHandlers();

        if (HAS_RIYADH_ROADS_TILES && map.getLayer(PUBLIC_LAYER_ID_RIYADH)) {
            const anchorId = map.getLayer('lr-lines')
                ? 'lr-lines'
                : map.getLayer('lr-fill')
                  ? 'lr-fill'
                  : map.getLayer('lr-points')
                    ? 'lr-points'
                    : null;
            if (anchorId) {
                try {
                    map.moveLayer(PUBLIC_LAYER_ID_RIYADH, anchorId);
                } catch (eMove) {
                    /* ignore */
                }
            }
        }
    }

    let uploadHoverHandlersBound = false;

    function bindUploadFeatureHoverHandlers() {
        if (uploadHoverHandlersBound) {
            return;
        }
        uploadHoverHandlersBound = true;
        ['lr-lines', 'lr-fill', 'lr-points'].forEach(function (layerId) {
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
        });
        setSelectionHighlight(fid);
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

            const tdPrev = document.createElement('td');
            tdPrev.className = 'lr-td-props';
            tdPrev.innerHTML = renderPropertiesCell(f);

            const tdAct = document.createElement('td');
            tdAct.className = 'lr-td-actions';
            const bA = document.createElement('button');
            bA.type = 'button';
            bA.className = 'lr-btn lr-btn-approve';
            bA.dataset.fid = String(f.id);
            bA.textContent = 'Approve';
            const bR = document.createElement('button');
            bR.type = 'button';
            bR.className = 'lr-btn lr-btn-reject';
            bR.dataset.fid = String(f.id);
            bR.textContent = 'Reject';
            tdAct.appendChild(bA);
            tdAct.appendChild(bR);

            tr.appendChild(tdNum);
            tr.appendChild(tdSt);
            tr.appendChild(tdPrev);
            tr.appendChild(tdAct);

            const rowRef = {
                bbox: f.bbox,
                center: f.center,
                geometry: f.geometry,
            };

            tr.addEventListener('click', function (e) {
                if (e.target.closest('.lr-btn')) {
                    return;
                }
                const fid = parseInt(tr.dataset.featureId, 10);
                setRowSelected(fid);
                zoomToFeature(rowRef);
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
        } else {
            selectedFeatureId = null;
            document.querySelectorAll('.lr-table-row.lr-row-selected').forEach(function (el) {
                el.classList.remove('lr-row-selected');
            });
            setSelectionHighlight(null);
        }
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

        map.on('click', function (e) {
            const layers = ['lr-lines', 'lr-fill', 'lr-points'].filter(function (id) {
                return map.getLayer(id);
            });
            if (!layers.length) {
                return;
            }
            const feats = map.queryRenderedFeatures(e.point, { layers: layers });
            if (!feats.length) {
                return;
            }
            const props = feats[0].properties || {};
            const fid =
                props.upload_feature_id != null ? parseInt(String(props.upload_feature_id), 10) : NaN;
            if (Number.isNaN(fid)) {
                return;
            }
            setRowSelected(fid);
            const geom = featureGeomById[fid];
            const tr = document.querySelector('#review-feature-rows tr[data-feature-id="' + String(fid) + '"]');
            let bbox;
            let center;
            if (tr && tr.dataset.bboxEnc && tr.dataset.centerEnc) {
                try {
                    bbox = JSON.parse(decodeURIComponent(tr.dataset.bboxEnc));
                    center = JSON.parse(decodeURIComponent(tr.dataset.centerEnc));
                } catch (err) {
                    /* ignore */
                }
            }
            zoomToFeature({ bbox: bbox, center: center, geometry: geom });
            if (tr) {
                tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });

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
