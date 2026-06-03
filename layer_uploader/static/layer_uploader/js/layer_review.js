/**
 * Layer review: map preview, feature table, and per-row / bulk include–exclude actions.
 */
(function () {
    const root = document.getElementById('layer-review-root');
    const mapEl = document.getElementById('review-map');
    if (!root || !mapEl || typeof maplibregl === 'undefined') {
        return;
    }
    if (!window.MapLineSelection) {
        console.error('layer_review.js requires mapping/js/map-line-selection.js');
        return;
    }

    const geojsonUrl = root.dataset.geojsonUrl;
    const tableUrl = root.dataset.tableUrl;
    const actionUrl = root.dataset.actionUrl;
    const submitUrl = root.dataset.submitUrl || '';
    const isManagerUploader = root.dataset.isManagerUploader === 'true';
    const largeLayer = root.dataset.largeLayer === 'true';
    const pageSize = parseInt(root.dataset.pageSize || '50', 10) || 50;

    function featureDetailUrl(featureId) {
        return tableUrl.replace(/table\.json.*/, 'features/' + String(featureId) + '.json');
    }

    const RIYADH_ROADS_TILE_URL = (root.dataset.riyadhRoadsTileUrl || '').trim();
    const HAS_RIYADH_ROADS_TILES = RIYADH_ROADS_TILE_URL.length > 0;

    const MAPTILER_API_KEY = (root.dataset.maptilerApiKey || '').trim();
    const HAS_MAPTILER = MAPTILER_API_KEY.length > 0;

    const RIYADH_LINE_WIDTH = 3;

    const MAP_GLYPHS_URL = HAS_MAPTILER
        ? 'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=' + MAPTILER_API_KEY
        : 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

    const SOURCE_ID_RIYADH = 'riyadh-roads';
    const PUBLIC_LAYER_ID_RIYADH = 'riyadh-roads-public-layer';
    const SOURCE_LAYER_RIYADH = 'riyadh_roads';
    const SOURCE_STAGING = 'lr-upload-staging';
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

    const MLS = window.MapLineSelection;
    const SELECTION_LINE_LAYOUT = MLS.SELECTION_LINE_LAYOUT;
    const SELECTION_LINE_PAINT = {
        casing: MLS.geoJsonSelectionCasingPaint(),
        core: MLS.geoJsonSelectionCorePaint([1, 0]),
    };
    const SELECTION_FILL_PAINT = MLS.geoJsonSelectionFillPaint();
    const SELECTION_POINT_PAINT = MLS.geoJsonSelectionPointPaint();

    const SELECTION_LAYER_IDS = [
        'lr-sel-fill',
        'lr-sel-line-casing',
        'lr-sel-line-core',
        'lr-sel-point',
    ];

    const UPLOAD_FEATURE_LAYER_GROUPS = [
        { layerIds: ['lr-lines', 'lr-all-lines'], geomFilter: GEOM_FILTER_LINE },
        { layerIds: ['lr-fill', 'lr-all-fill'], geomFilter: GEOM_FILTER_POLY },
        { layerIds: ['lr-points', 'lr-all-points'], geomFilter: GEOM_FILTER_POINT },
    ];

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
    const zoomPanel = document.getElementById('lr-zoom-panel');
    const btnZoomPanelToggle = document.getElementById('lr-zoom-panel-toggle');
    const zoomFeatureList = document.getElementById('lr-zoom-feature-list');

    let mapZoomOpen = false;
    let zoomPanelOpen = true;
    let zoomFeatureListRequestId = 0;

    const ZOOM_PANEL_MAP_PADDING_PX = 400;
    const ESRI_SATELLITE_BASEMAP_ID = 'esri-satellite';
    const DEFAULT_BASEMAP_MAX_ZOOM = 19;
    const BASEMAP_RASTER_LAYER_MAX_ZOOM = 22;
    const ZOOM_OVERVIEW_MAX_INLINE = 16;
    const ZOOM_OVERVIEW_MAX_MODAL = 15;
    const ZOOM_POINT_MAX_INLINE = 17;

    function buildBasemapDefinitions() {
        const defs = [
            {
                id: ESRI_SATELLITE_BASEMAP_ID,
                label: 'Satellite',
                theme: 'imagery',
                sourceId: 'review-bm-esri',
                layerId: 'review-bm-esri-layer',
                tiles: [
                    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                ],
                attribution: 'Esri, Maxar, Earthstar Geographics',
                maxZoom: DEFAULT_BASEMAP_MAX_ZOOM,
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
                    maxZoom: 17,
                    preferSatelliteInZoom: true,
                },
                {
                    id: 'maptiler-outdoor',
                    label: 'Outdoor',
                    theme: 'light',
                    sourceId: 'review-bm-mt-outdoor',
                    layerId: 'review-bm-mt-outdoor-layer',
                    tiles: [mb + '/outdoor-v2/256/{z}/{x}/{y}.png?key=' + k],
                    attribution: '© MapTiler © OpenStreetMap contributors',
                    maxZoom: 17,
                    preferSatelliteInZoom: true,
                }
            );
        }
        return defs;
    }

    const BASEMAP_DEFINITIONS = buildBasemapDefinitions();
    let currentBasemapId = ESRI_SATELLITE_BASEMAP_ID;
    let basemapIdBeforeZoom = null;

    function basemapDefById(basemapId) {
        return BASEMAP_DEFINITIONS.find(function (d) {
            return d.id === basemapId;
        });
    }

    function activeBasemapMaxZoom() {
        const def = basemapDefById(currentBasemapId);
        return def && def.maxZoom != null ? def.maxZoom : DEFAULT_BASEMAP_MAX_ZOOM;
    }

    function overviewFitMaxZoom() {
        if (mapZoomOpen) {
            return Math.min(ZOOM_OVERVIEW_MAX_MODAL, activeBasemapMaxZoom());
        }
        return ZOOM_OVERVIEW_MAX_INLINE;
    }

    function applyBasemapZoomLimits() {
        const maxZ = activeBasemapMaxZoom();
        try {
            map.setMaxZoom(maxZ);
            if (map.getZoom() > maxZ + 0.05) {
                map.easeTo({ zoom: maxZ, duration: 280 });
            }
        } catch (e) {
            /* ignore */
        }
    }

    function prepareBasemapForZoomModal() {
        const def = basemapDefById(currentBasemapId);
        if (!def || !def.preferSatelliteInZoom) {
            return;
        }
        if (basemapIdBeforeZoom == null) {
            basemapIdBeforeZoom = currentBasemapId;
        }
        setBasemap(ESRI_SATELLITE_BASEMAP_ID);
    }

    function restoreBasemapAfterZoomModal() {
        if (!basemapIdBeforeZoom) {
            return;
        }
        setBasemap(basemapIdBeforeZoom);
        basemapIdBeforeZoom = null;
    }

    function buildInitialStyle() {
        const sources = {};
        const layers = [];
        BASEMAP_DEFINITIONS.forEach(function (def) {
            sources[def.sourceId] = {
                type: 'raster',
                tiles: def.tiles,
                tileSize: 256,
                maxzoom: def.maxZoom != null ? def.maxZoom : DEFAULT_BASEMAP_MAX_ZOOM,
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
                maxzoom: BASEMAP_RASTER_LAYER_MAX_ZOOM,
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
        maxZoom: activeBasemapMaxZoom(),
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
                staging: '#e8e8e8',
                pointStroke: '#ffffff',
            };
        }
        return {
            riyadh: RIYADH_ROADS_LINE_COLOR,
            staging: '#525252',
            pointStroke: '#fafafa',
        };
    }

    function uploadFeatureExcludeFilter(geomFilter) {
        if (selectedFeatureId == null) {
            return geomFilter;
        }
        return ['all', geomFilter, ['!=', ['id'], selectedFeatureId]];
    }

    function syncSelectionExclusionFilters() {
        try {
            UPLOAD_FEATURE_LAYER_GROUPS.forEach(function (group) {
                group.layerIds.forEach(function (layerId) {
                    if (map.getLayer(layerId)) {
                        map.setFilter(layerId, uploadFeatureExcludeFilter(group.geomFilter));
                    }
                });
            });
        } catch (e) {
            /* ignore */
        }
    }

    function moveSelectionLayersToTop() {
        SELECTION_LAYER_IDS.forEach(function (layerId) {
            if (!map.getLayer(layerId)) {
                return;
            }
            try {
                map.moveLayer(layerId);
            } catch (e) {
                /* ignore */
            }
        });
    }

    function themeForBasemapId(basemapId) {
        const def = basemapDefById(basemapId);
        return def && def.theme ? def.theme : 'light';
    }

    function applyOverlayThemeForBasemap(basemapId) {
        const pal = overlayPalette(themeForBasemapId(basemapId));
        try {
            if (map.getLayer(PUBLIC_LAYER_ID_RIYADH)) {
                map.setPaintProperty(PUBLIC_LAYER_ID_RIYADH, 'line-color', pal.riyadh);
            }
            if (map.getLayer('lr-lines')) {
                map.setPaintProperty('lr-lines', 'line-color', pal.staging);
            }
            if (map.getLayer('lr-fill')) {
                map.setPaintProperty('lr-fill', 'fill-color', pal.staging);
                map.setPaintProperty('lr-fill', 'fill-outline-color', pal.staging);
            }
            if (map.getLayer('lr-points')) {
                map.setPaintProperty('lr-points', 'circle-color', pal.staging);
                map.setPaintProperty('lr-points', 'circle-stroke-color', pal.pointStroke);
            }
        } catch (e) {
            /* ignore missing layers during startup */
        }
    }

    function setBasemap(basemapId) {
        if (!basemapDefById(basemapId)) {
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
        applyBasemapZoomLimits();
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
        applyBasemapZoomLimits();
    }

    let selectedFeatureId = null;
    const featureGeomById = {};
    let layerExtent = null;
    let currentPage = 1;
    let statusFilter = '';
    let mapLoadTimer = null;
    let mapLoadInFlight = false;

    const paginationNav = document.getElementById('lr-table-pagination');
    const btnPagePrev = document.getElementById('lr-page-prev');
    const btnPageNext = document.getElementById('lr-page-next');
    const pageStatusEl = document.getElementById('lr-page-status');
    const statusFilterEl = document.getElementById('lr-status-filter');
    const layerTotalEl = document.getElementById('lr-layer-feature-total');
    const layerNewEl = document.getElementById('lr-layer-feature-new');

    function reviewTileUrl(baseUrl) {
        if (!baseUrl) {
            return baseUrl;
        }
        if (typeof window.buildRiyadhRoadsTileUrl === 'function') {
            return window.buildRiyadhRoadsTileUrl(baseUrl, window.__riyadhTilesVersion || Date.now());
        }
        const sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
        return baseUrl + sep + 'v=' + encodeURIComponent(String(Date.now()));
    }

    function ensureRiyadhRoadsSource() {
        if (!HAS_RIYADH_ROADS_TILES || map.getSource(SOURCE_ID_RIYADH)) {
            return;
        }
        const bustedUrl = reviewTileUrl(RIYADH_ROADS_TILE_URL);
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

    function rowRefFromElement(el) {
        if (!el) {
            return null;
        }
        const fid = parseInt(el.dataset.featureId, 10);
        let bbox;
        let center;
        if (el.dataset.bboxEnc && el.dataset.centerEnc) {
            try {
                bbox = JSON.parse(decodeURIComponent(el.dataset.bboxEnc));
                center = JSON.parse(decodeURIComponent(el.dataset.centerEnc));
            } catch (e) {
                /* ignore */
            }
        }
        return { bbox: bbox, center: center, geometry: featureGeomById[fid] };
    }

    function mapZoomFitPadding() {
        const side = zoomPanelOpen ? ZOOM_PANEL_MAP_PADDING_PX : 96;
        return { top: 96, bottom: 96, left: 96, right: side };
    }

    function featureRowRef(f) {
        return {
            bbox: f.bbox,
            center: f.center,
            geometry: featureGeomById[f.id] || f.geometry || null,
        };
    }

    function stampFeatureDataset(el, f) {
        el.dataset.featureId = String(f.id);
        el.dataset.bboxEnc = encodeURIComponent(JSON.stringify(f.bbox));
        el.dataset.centerEnc = encodeURIComponent(JSON.stringify(f.center));
    }

    function isActionableStatus(status) {
        return status === 'staged';
    }

    function isResetableStatus(status) {
        return status === 'nominated' || status === 'rejected_upload';
    }

    function applyFeatureStatusClasses(el, status) {
        el.classList.remove('lr-row-nominated', 'lr-row-rejected_upload');
        if (status === 'nominated') {
            el.classList.add('lr-row-nominated');
        } else if (status === 'rejected_upload') {
            el.classList.add('lr-row-rejected_upload');
        }
    }

    function fillActionCell(container, status) {
        container.innerHTML = '';

        if (isActionableStatus(status)) {
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'lr-action-btn lr-action-btn--approve';
            approve.setAttribute('aria-label', 'Include feature');
            approve.setAttribute('title', 'Include');
            approve.innerHTML = ICON_APPROVE_SVG;

            const reject = document.createElement('button');
            reject.type = 'button';
            reject.className = 'lr-action-btn lr-action-btn--reject';
            reject.setAttribute('aria-label', 'Exclude feature');
            reject.setAttribute('title', 'Exclude');
            reject.innerHTML = ICON_REJECT_SVG;

            container.appendChild(approve);
            container.appendChild(reject);
            return;
        }

        if (isResetableStatus(status)) {
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'lr-btn-reset';
            reset.textContent = 'Reset';
            reset.setAttribute('aria-label', 'Reset to new');
            reset.setAttribute('title', 'Move back to new so you can include or exclude again');
            container.appendChild(reset);
        }
    }

    const STATUS_COUNT_IDS = {
        total: ['cnt-total', 'lr-zoom-cnt-total'],
        staged: ['cnt-staged', 'lr-zoom-cnt-staged'],
        nominated: ['cnt-nominated', 'lr-zoom-cnt-nominated'],
        rejected_upload: ['cnt-rejected_upload', 'lr-zoom-cnt-rejected_upload'],
    };

    function featureListSelector(fid) {
        return mapZoomOpen
            ? '.lr-zoom-feature-card[data-feature-id="' + String(fid) + '"]'
            : '#review-feature-rows tr[data-feature-id="' + String(fid) + '"]';
    }

    function renderStatusCounts(counts) {
        const c = counts || {};
        Object.keys(STATUS_COUNT_IDS).forEach(function (status) {
            const value = c[status] != null ? String(c[status]) : '0';
            STATUS_COUNT_IDS[status].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = value;
                }
            });
        });
    }

    function updateReviewSummary(payload) {
        const counts = payload.counts || {};
        renderStatusCounts(counts);
        if (payload.total_features != null && layerTotalEl) {
            layerTotalEl.textContent = String(payload.total_features);
        }
        if (counts.staged != null && layerNewEl) {
            layerNewEl.textContent = String(counts.staged);
        }
    }

    function renderZoomPanelFeatureCount(count) {
        const countEl = document.getElementById('lr-zoom-panel-count');
        if (!countEl) {
            return;
        }
        const n = count != null ? count : 0;
        countEl.textContent = n === 1 ? '1 feature' : String(n) + ' features';
    }

    function setZoomFeatureListLoading(loading) {
        if (!zoomFeatureList) {
            return;
        }
        zoomFeatureList.classList.toggle('lr-zoom-feature-list--loading', !!loading);
        if (loading) {
            zoomFeatureList.innerHTML =
                '<p class="lr-zoom-empty lr-zoom-loading">Loading features…</p>';
        }
    }

    function zoomTableQueryUrl() {
        const params = new URLSearchParams();
        params.set('list', 'all');
        if (statusFilter) {
            params.set('status', statusFilter);
        }
        const join = tableUrl.indexOf('?') >= 0 ? '&' : '?';
        return tableUrl + join + params.toString();
    }

    function loadZoomFeatureList() {
        if (!zoomFeatureList) {
            return Promise.resolve();
        }
        const requestId = ++zoomFeatureListRequestId;
        setZoomFeatureListLoading(true);
        return fetchReviewJson(zoomTableQueryUrl())
            .then(function (payload) {
                if (requestId !== zoomFeatureListRequestId) {
                    return payload;
                }
                const feats = payload.features || [];
                updateReviewSummary(payload);
                renderZoomFeaturePanel(feats);
                restoreFeatureSelection();
                return payload;
            })
            .catch(function (err) {
                if (requestId !== zoomFeatureListRequestId) {
                    return;
                }
                zoomFeatureList.innerHTML =
                    '<p class="lr-zoom-empty">Could not load features. ' +
                    escapeHtml(err.message || 'Try again.') +
                    '</p>';
                window.notify.tryShow('Failed to load features for the panel.', 'error');
            });
    }

    function postFeatureAction(action, featureId, failureLabel) {
        return postAction({ action: action, feature_id: featureId })
            .then(function () {
                return refreshAfterMutation();
            })
            .catch(function (err) {
                window.notify.tryShow(err.message || failureLabel, 'error');
            });
    }

    function indexGeojsonFeatures(geo) {
        if (!geo || !geo.features) {
            return;
        }
        geo.features.forEach(function (feat) {
            const props = feat.properties || {};
            const fid =
                feat.id != null
                    ? parseInt(String(feat.id), 10)
                    : parseInt(String(props.upload_feature_id), 10);
            if (!Number.isNaN(fid) && feat.geometry) {
                featureGeomById[fid] = feat.geometry;
            }
        });
    }

    function ensureFeatureGeometry(fid) {
        if (featureGeomById[fid]) {
            return Promise.resolve(featureGeomById[fid]);
        }
        return fetchReviewJson(featureDetailUrl(fid)).then(function (row) {
            if (row.geometry) {
                featureGeomById[fid] = row.geometry;
            }
            return row.geometry;
        });
    }

    function tableQueryUrl(page) {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('page_size', String(pageSize));
        if (statusFilter) {
            params.set('status', statusFilter);
        }
        const join = tableUrl.indexOf('?') >= 0 ? '&' : '?';
        return tableUrl + join + params.toString();
    }

    function geojsonQueryUrl(bbox) {
        if (!bbox) {
            return geojsonUrl;
        }
        const join = geojsonUrl.indexOf('?') >= 0 ? '&' : '?';
        return geojsonUrl + join + 'bbox=' + encodeURIComponent(bbox.join(','));
    }

    function updatePaginationUi(pagination) {
        if (!paginationNav || !pagination) {
            return;
        }
        const totalPages = pagination.total_pages || 1;
        const show = totalPages > 1 || (pagination.total || 0) > pageSize;
        paginationNav.hidden = !show;
        if (pageStatusEl) {
            pageStatusEl.textContent =
                'Page ' + String(pagination.page) + ' of ' + String(totalPages) +
                ' · ' + String(pagination.total) + ' rows';
        }
        if (btnPagePrev) {
            btnPagePrev.disabled = pagination.page <= 1;
        }
        if (btnPageNext) {
            btnPageNext.disabled = pagination.page >= totalPages;
        }
    }

    function loadTablePage(page) {
        currentPage = page;
        return fetchReviewJson(tableQueryUrl(page)).then(function (payload) {
            renderTable(payload);
            return payload;
        });
    }

    function fitLayerExtent(extent) {
        if (!extent || extent.length !== 2) {
            return;
        }
        try {
            map.fitBounds(new maplibregl.LngLatBounds(extent[0], extent[1]), {
                padding: { top: 80, bottom: 80, left: 80, right: 80 },
                maxZoom: 14,
                duration: 0,
            });
        } catch (e) {
            /* ignore */
        }
    }

    function loadMapViewport() {
        if (!map.isStyleLoaded()) {
            return Promise.resolve();
        }
        if (mapLoadInFlight) {
            return Promise.resolve();
        }
        const bounds = map.getBounds();
        const bbox = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
        ];
        mapLoadInFlight = true;
        return fetchReviewJson(geojsonQueryUrl(bbox))
            .then(function (geo) {
                setStagingSourceData(geo);
                indexGeojsonFeatures(geo);
                if (largeLayer && map.getSource(SOURCE_ALL)) {
                    map.getSource(SOURCE_ALL).setData(geo);
                }
            })
            .finally(function () {
                mapLoadInFlight = false;
            });
    }

    function scheduleMapReload() {
        clearTimeout(mapLoadTimer);
        mapLoadTimer = setTimeout(function () {
            loadMapViewport();
        }, 320);
    }

    function refreshMapData() {
        if (largeLayer) {
            return loadMapViewport();
        }
        return fetchReviewJson(geojsonUrl).then(function (geo) {
            setStagingSourceData(geo);
            indexGeojsonFeatures(geo);
            if (map.getSource(SOURCE_ALL)) {
                map.getSource(SOURCE_ALL).setData(geo);
            }
        });
    }

    function refreshAfterMutation() {
        return Promise.all([refreshMapData(), reloadTableAndZoomPanel(currentPage)]);
    }

    function clearFeatureSelection() {
        selectedFeatureId = null;
        document.querySelectorAll('.lr-row-selected').forEach(function (el) {
            el.classList.remove('lr-row-selected');
        });
        setSelectionHighlight(null);
    }

    function restoreFeatureSelection() {
        const restore = selectedFeatureId;
        if (restore == null) {
            clearFeatureSelection();
            return;
        }
        const el = document.querySelector(featureListSelector(restore));
        const ref = rowRefFromElement(el);
        if (!ref) {
            clearFeatureSelection();
            return;
        }
        setRowSelected(restore);
        zoomToFeature(ref);
        ensureFeatureGeometry(restore).then(function () {
            setSelectionHighlight(restore);
        });
    }

    function setZoomPanelOpen(open) {
        zoomPanelOpen = open;
        if (zoomPanel) {
            zoomPanel.classList.toggle('lr-zoom-panel--closed', !open);
            zoomPanel.dataset.open = open ? 'true' : 'false';
        }
        if (btnZoomPanelToggle) {
            btnZoomPanelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        if (mapZoomOpen) {
            resizeMapSoon();
        }
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
        const el = document.querySelector(featureListSelector(fid));
        const ref = rowRefFromElement(el);
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
        const beforeId = SELECTION_LAYER_IDS.find(function (id) {
            return map.getLayer(id);
        });
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
        moveSelectionLayersToTop();
        syncSelectionExclusionFilters();
    }

    function syncMapFeatureLayers() {
        if (!map.isStyleLoaded()) {
            return;
        }
        if (largeLayer) {
            setLayerGroupVisibility(UPLOAD_LAYER_IDS, true);
            setLayerGroupVisibility(ALL_LAYER_IDS, false);
            return;
        }
        ensureAllFeaturesSourceAndLayers();
        setLayerGroupVisibility(UPLOAD_LAYER_IDS, !mapZoomOpen);
        setLayerGroupVisibility(ALL_LAYER_IDS, mapZoomOpen);
    }

    function zoomToAllFeatures() {
        const extentMaxZoom = overviewFitMaxZoom();
        if (layerExtent) {
            const padded =
                boundsArea(layerExtent) < 1e-12 ? padBounds(layerExtent, 0.01) : layerExtent;
            try {
                map.fitBounds(new maplibregl.LngLatBounds(padded[0], padded[1]), {
                    padding: mapZoomOpen ? mapZoomFitPadding() : { top: 80, bottom: 80, left: 80, right: 80 },
                    maxZoom: extentMaxZoom,
                    duration: 900,
                });
            } catch (e) {
                /* ignore */
            }
            return;
        }
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
                padding: mapZoomOpen ? mapZoomFitPadding() : { top: 80, bottom: 80, left: 80, right: 80 },
                maxZoom: extentMaxZoom,
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
                'Focused on feature #' + String(selectedFeatureId) + '. Select another in the panel to refocus.';
            return;
        }
        mapZoomSub.textContent = 'All features are shown. Open the Features panel to select one.';
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
        setZoomPanelOpen(true);
        prepareBasemapForZoomModal();
        syncMapFeatureLayers();
        updateZoomModalSubtitle();
        resizeMapSoon(function () {
            loadZoomFeatureList().then(function () {
                zoomToAllFeatures();
                if (largeLayer) {
                    loadMapViewport();
                }
            });
        });
    }

    function closeMapZoomModal() {
        if (!mapZoomOverlay || !mapInlineHome || !mapZoomOpen) {
            return;
        }
        zoomFeatureListRequestId += 1;
        mapInlineHome.appendChild(mapEl);
        mapZoomOverlay.hidden = true;
        mapZoomOverlay.setAttribute('aria-hidden', 'true');
        mapZoomOpen = false;
        document.body.style.overflow = '';
        restoreBasemapAfterZoomModal();
        syncMapFeatureLayers();
        resizeMapSoon();
    }

    function focusFeature(fid, rowRef) {
        setRowSelected(fid);
        zoomToFeature(rowRef);
        ensureFeatureGeometry(fid).then(function () {
            setSelectionHighlight(fid);
        });
        if (!mapZoomOpen) {
            mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function zoomToFeature(row) {
        if (mapZoomOpen) {
            prepareBasemapForZoomModal();
        }
        const focusMaxZoom = activeBasemapMaxZoom();
        let bb = row.bbox;
        const center = row.center;
        const geom = row.geometry;
        const fitPadding = mapZoomOpen ? mapZoomFitPadding() : { top: 72, bottom: 72, left: 72, right: 72 };

        if (!bb || !Array.isArray(bb) || bb.length !== 2) {
            bb = geom ? boundsFromGeometry(geom) : null;
        }

        if (bb && boundsArea(bb) < 1e-10) {
            bb = padBounds(bb, 0.002);
        }

        if (center && Array.isArray(center) && center.length === 2 && (!bb || boundsArea(bb) < 1e-16)) {
            const pointZoom = mapZoomOpen
                ? focusMaxZoom
                : Math.min(ZOOM_POINT_MAX_INLINE, focusMaxZoom);
            map.easeTo({
                center: center,
                zoom: pointZoom,
                duration: 750,
            });
            return;
        }

        if (bb && bb.length === 2) {
            try {
                const lngLatBounds = new maplibregl.LngLatBounds(bb[0], bb[1]);
                map.fitBounds(lngLatBounds, {
                    padding: fitPadding,
                    maxZoom: focusMaxZoom,
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
                        padding: fitPadding,
                        maxZoom: focusMaxZoom,
                        duration: 850,
                    });
                } catch (e2) {
                    /* ignore */
                }
            }
        }
    }

    function selectionFeatureGeoJson(fid, geometry) {
        return {
            type: 'Feature',
            id: fid,
            geometry: geometry,
            properties: { upload_feature_id: fid },
        };
    }

    function finishSelectionHighlightUpdate() {
        moveSelectionLayersToTop();
        syncSelectionExclusionFilters();
    }

    function addSelectionMapLayers() {
        map.addSource(SOURCE_SELECTION, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            promoteId: 'upload_feature_id',
        });
        map.addLayer({
            id: 'lr-sel-fill',
            type: 'fill',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_POLY,
            paint: SELECTION_FILL_PAINT,
        });
        map.addLayer({
            id: 'lr-sel-line-casing',
            type: 'line',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_LINE,
            layout: SELECTION_LINE_LAYOUT,
            paint: SELECTION_LINE_PAINT.casing,
        });
        map.addLayer({
            id: 'lr-sel-line-core',
            type: 'line',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_LINE,
            layout: SELECTION_LINE_LAYOUT,
            paint: SELECTION_LINE_PAINT.core,
        });
        map.addLayer({
            id: 'lr-sel-point',
            type: 'circle',
            source: SOURCE_SELECTION,
            filter: GEOM_FILTER_POINT,
            paint: SELECTION_POINT_PAINT,
        });
    }

    function ensureSelectionSourceAndLayers() {
        if (!map.getSource(SOURCE_SELECTION)) {
            addSelectionMapLayers();
            applyOverlayThemeForBasemap(currentBasemapId);
        }
        finishSelectionHighlightUpdate();
    }

    function setSelectionHighlight(fid) {
        ensureSelectionSourceAndLayers();
        const src = map.getSource(SOURCE_SELECTION);
        if (!src) {
            return;
        }
        if (fid == null || fid < 0) {
            src.setData({ type: 'FeatureCollection', features: [] });
            finishSelectionHighlightUpdate();
            return;
        }
        const g = featureGeomById[fid];
        if (g) {
            src.setData({
                type: 'FeatureCollection',
                features: [selectionFeatureGeoJson(fid, g)],
            });
            finishSelectionHighlightUpdate();
            return;
        }
        ensureFeatureGeometry(fid).then(function (geom) {
            if (!geom || selectedFeatureId !== fid) {
                return;
            }
            src.setData({
                type: 'FeatureCollection',
                features: [selectionFeatureGeoJson(fid, geom)],
            });
            finishSelectionHighlightUpdate();
        });
    }

    function addUploadOverlayLayers() {
        if (!map.getSource(SOURCE_STAGING)) {
            return;
        }

        if (!map.getLayer('lr-lines')) {
            map.addLayer({
                id: 'lr-lines',
                type: 'line',
                source: SOURCE_STAGING,
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
                source: SOURCE_STAGING,
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
                source: SOURCE_STAGING,
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
        syncSelectionExclusionFilters();
        moveSelectionLayersToTop();

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

    function setStagingSourceData(data) {
        if (!map.getSource(SOURCE_STAGING)) {
            map.addSource(SOURCE_STAGING, {
                type: 'geojson',
                data: data,
                promoteId: 'upload_feature_id',
            });
            addUploadOverlayLayers();
        } else {
            map.getSource(SOURCE_STAGING).setData(data);
        }
    }

    function setRowSelected(fid) {
        selectedFeatureId = fid;
        document
            .querySelectorAll('.lr-table-row[data-feature-id], .lr-zoom-feature-card[data-feature-id]')
            .forEach(function (el) {
                const id = parseInt(el.getAttribute('data-feature-id'), 10);
                const on = id === fid;
                el.classList.toggle('lr-row-selected', on);
                if (on) {
                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            });
        setSelectionHighlight(fid);
        updateZoomModalSubtitle();
    }

    function wireFeatureInteractions(el, f, rowRef) {
        el.addEventListener('click', function (e) {
            if (e.target.closest('.lr-action-btn, .lr-btn-reset')) {
                return;
            }
            focusFeature(f.id, rowRef);
        });

        const approve = el.querySelector('.lr-action-btn--approve');
        const reject = el.querySelector('.lr-action-btn--reject');
        const reset = el.querySelector('.lr-btn-reset');
        if (approve) {
            approve.addEventListener('click', function (e) {
                e.stopPropagation();
                postFeatureAction('nominate', f.id, 'Include');
            });
        }
        if (reject) {
            reject.addEventListener('click', function (e) {
                e.stopPropagation();
                postFeatureAction('reject', f.id, 'Exclude');
            });
        }
        if (reset) {
            reset.addEventListener('click', function (e) {
                e.stopPropagation();
                postFeatureAction('reset', f.id, 'Reset');
            });
        }
    }

    function buildZoomFeatureCard(f, idx) {
        const card = document.createElement('article');
        card.className = 'lr-zoom-feature-card';
        card.setAttribute('role', 'listitem');
        stampFeatureDataset(card, f);

        const row = document.createElement('div');
        row.className = 'lr-zoom-card-row';

        const num = document.createElement('span');
        num.className = 'lr-zoom-card-num';
        num.textContent = String(idx + 1);

        const statusWrap = document.createElement('div');
        statusWrap.className = 'lr-zoom-card-status';
        statusWrap.innerHTML = statusBadge(f.status);

        const actions = document.createElement('div');
        actions.className = 'lr-zoom-card-actions';
        fillActionCell(actions, f.status);

        row.appendChild(num);
        row.appendChild(statusWrap);
        row.appendChild(actions);

        const props = document.createElement('div');
        props.className = 'lr-zoom-card-props';
        props.innerHTML = renderRoadNameCell(f) + renderPropertiesCell(f);

        card.appendChild(row);
        card.appendChild(props);
        applyFeatureStatusClasses(card, f.status);
        wireFeatureInteractions(card, f, featureRowRef(f));
        return card;
    }

    function renderZoomFeaturePanel(feats) {
        if (!zoomFeatureList) {
            return;
        }
        const list = feats || [];
        renderZoomPanelFeatureCount(list.length);
        zoomFeatureList.classList.remove('lr-zoom-feature-list--loading');
        zoomFeatureList.innerHTML = '';
        if (!list.length) {
            zoomFeatureList.innerHTML =
                '<p class="lr-zoom-empty">No features match the current filter.</p>';
            return;
        }
        const fragment = document.createDocumentFragment();
        list.forEach(function (f, idx) {
            fragment.appendChild(buildZoomFeatureCard(f, idx));
        });
        zoomFeatureList.appendChild(fragment);
    }

    function buildTableRow(f, displayIndex) {
        const tr = document.createElement('tr');
        tr.className = 'lr-table-row';
        stampFeatureDataset(tr, f);

        const tdNum = document.createElement('td');
        tdNum.className = 'lr-td-num';
        tdNum.textContent = String(displayIndex);

        const tdSt = document.createElement('td');
        tdSt.className = 'lr-td-status';
        tdSt.innerHTML = statusBadge(f.status);

        const tdName = document.createElement('td');
        tdName.className = 'lr-td-road-name';
        tdName.innerHTML = renderRoadNameCell(f);

        const tdProps = document.createElement('td');
        tdProps.className = 'lr-td-props';
        tdProps.innerHTML = renderPropertiesCell(f);

        const tdAct = document.createElement('td');
        tdAct.className = 'lr-td-actions';
        fillActionCell(tdAct, f.status);

        tr.appendChild(tdNum);
        tr.appendChild(tdSt);
        tr.appendChild(tdName);
        tr.appendChild(tdProps);
        tr.appendChild(tdAct);
        applyFeatureStatusClasses(tr, f.status);
        wireFeatureInteractions(tr, f, featureRowRef(f));
        return tr;
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

    const STATUS_LABELS = {
        staged: 'New',
        nominated: 'Included',
        rejected_upload: 'Excluded',
    };

    function statusBadge(status) {
        const label = STATUS_LABELS[status] || status;
        let cls = 'lr-badge-staged';
        if (status === 'nominated') {
            cls = 'lr-badge-nominated';
        } else if (status === 'rejected_upload') {
            cls = 'lr-badge-rejected';
        }
        return '<span class="lr-badge ' + cls + '">' + escapeHtml(String(label)) + '</span>';
    }

    function renderRoadNameCell(f) {
        const name = f.road_name != null ? String(f.road_name).trim() : '';
        if (!name) {
            return '<span class="lr-road-name lr-road-name--empty">Unnamed road</span>';
        }
        return '<span class="lr-road-name">' + escapeHtml(name) + '</span>';
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
        updateReviewSummary(payload);

        if (payload.extent) {
            layerExtent = payload.extent;
        }
        updatePaginationUi(payload.pagination || null);

        const feats = payload.features || [];
        const pagination = payload.pagination || {};
        const rowOffset = ((pagination.page || 1) - 1) * (pagination.page_size || pageSize);

        tbody.innerHTML = '';
        if (!feats.length) {
            tbody.innerHTML =
                '<tr><td colspan="5" class="lr-empty">No roads match this filter on this page.</td></tr>';
        } else {
            feats.forEach(function (f, idx) {
                tbody.appendChild(buildTableRow(f, rowOffset + idx + 1));
            });
        }
        afterTableRendered();
    }

    function afterTableRendered() {
        if (mapZoomOpen) {
            loadZoomFeatureList();
            return;
        }
        restoreFeatureSelection();
    }

    function reloadTableAndZoomPanel(page) {
        return loadTablePage(page || currentPage).then(function () {
            if (mapZoomOpen) {
                return loadZoomFeatureList();
            }
        });
    }

    function initReviewData() {
        return loadTablePage(1)
            .then(function (payload) {
                if (payload.extent) {
                    layerExtent = payload.extent;
                    fitLayerExtent(layerExtent);
                }
                if (largeLayer) {
                    return loadMapViewport();
                }
                return fetchReviewJson(geojsonUrl).then(function (geo) {
                    setStagingSourceData(geo);
                    indexGeojsonFeatures(geo);
                });
            })
            .then(function () {
                applyOverlayThemeForBasemap(currentBasemapId);
                syncMapFeatureLayers();
            })
            .catch(function () {
                window.notify.tryShow('Failed to load review data.', 'error');
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
        if (btnZoomPanelToggle) {
            btnZoomPanelToggle.addEventListener('click', function () {
                setZoomPanelOpen(!zoomPanelOpen);
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && mapZoomOpen) {
                closeMapZoomModal();
            }
        });

        map.on('click', focusFeatureFromMapClick);
        map.on('moveend', function () {
            if (largeLayer) {
                scheduleMapReload();
            }
        });

        if (statusFilterEl) {
            statusFilterEl.addEventListener('change', function () {
                statusFilter = statusFilterEl.value || '';
                reloadTableAndZoomPanel(1).catch(function () {
                    window.notify.tryShow('Failed to load table.', 'error');
                });
            });
        }
        if (btnPagePrev) {
            btnPagePrev.addEventListener('click', function () {
                if (currentPage > 1) {
                    loadTablePage(currentPage - 1);
                }
            });
        }
        if (btnPageNext) {
            btnPageNext.addEventListener('click', function () {
                loadTablePage(currentPage + 1);
            });
        }

        initReviewData().then(function () {
            setTimeout(function () {
                map.resize();
            }, 50);
        });
    });

    function runBulkAction(action, errorMessage) {
        postAction({ action: action })
            .then(function () {
                return refreshAfterMutation();
            })
            .catch(function (err) {
                window.notify.tryShow(err.message || errorMessage, 'error');
            });
    }

    const btnApproveAll = document.getElementById('btn-approve-all');
    const btnRejectAll = document.getElementById('btn-reject-all');
    if (btnApproveAll) {
        btnApproveAll.addEventListener('click', function () {
            runBulkAction('nominate_all', 'Could not include all rows');
        });
    }
    if (btnRejectAll) {
        btnRejectAll.addEventListener('click', function () {
            runBulkAction('reject_all', 'Could not exclude all rows');
        });
    }

    function submitLayerToManager() {
        return fetch(submitUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
                Accept: 'application/json',
            },
            body: JSON.stringify({}),
        })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (j) {
                        throw new Error(j.detail || r.statusText);
                    });
                }
                return r.json();
            })
            .then(function (payload) {
                if (payload && payload.tiles_version && typeof window.triggerRiyadhTilesReload === 'function') {
                    window.triggerRiyadhTilesReload(payload.tiles_version);
                }
                if (payload.redirect_url) {
                    window.location.href = payload.redirect_url;
                }
            })
            .catch(function (err) {
                window.notify.tryShow(err.message || 'Could not submit layer', 'error');
            });
    }

    const btnSubmit = document.getElementById('btn-submit-manager');
    if (btnSubmit && submitUrl) {
        btnSubmit.addEventListener('click', function () {
            const nominatedEl = document.getElementById('cnt-nominated');
            const nominatedCount = nominatedEl ? parseInt(nominatedEl.textContent, 10) : 0;
            if (!nominatedCount || Number.isNaN(nominatedCount)) {
                window.notify.tryShow(
                    isManagerUploader
                        ? 'Include at least one road before publishing.'
                        : 'Include at least one road before submitting.',
                    'warning'
                );
                return;
            }
            const confirmMsg = isManagerUploader
                ? 'Publish ' + nominatedCount + ' included road(s) to the map now? This cannot be undone.'
                : 'Submit ' + nominatedCount + ' included road(s) for review? You will not be able to edit this layer afterward.';
            const confirmTitle = isManagerUploader ? 'Publish layer' : 'Submit for review';
            const confirmLabel = isManagerUploader ? 'Publish' : 'Submit';

            const runSubmit = function () {
                submitLayerToManager();
            };

            window.notify
                .confirm({
                    title: confirmTitle,
                    message: confirmMsg,
                    confirmLabel: confirmLabel,
                    cancelLabel: 'Cancel',
                })
                .then(function (ok) {
                    if (ok) {
                        runSubmit();
                    }
                });
        });
    }
})();
