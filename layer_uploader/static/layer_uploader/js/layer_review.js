/**
 * Layer review: map workspace with features panel, basemap gallery, and approve/reject actions.
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
    const UPLOAD_LINE_HIT_LAYER_ID = 'lr-lines-hit';
    const ALL_LINE_HIT_LAYER_ID = 'lr-all-lines-hit';
    const UPLOAD_LAYER_GROUP = UPLOAD_LAYER_IDS.concat([UPLOAD_LINE_HIT_LAYER_ID]);
    const ALL_LAYER_GROUP = ALL_LAYER_IDS.concat([ALL_LINE_HIT_LAYER_ID]);
    const MAP_FEATURE_CLICK_PAD_PX = 12;

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

    /** Network roads overlay (matches main map public layer color). */
    const RIYADH_ROADS_LINE_COLOR = '#686d75';

    /** Upload feature colors by review status (geojson `properties.status`). */
    const UPLOAD_COLOR_NEW = '#0000F7';
    const UPLOAD_COLOR_APPROVED = '#02AD41';
    const UPLOAD_COLOR_REJECTED = '#F77E7E';
    const UPLOAD_LINE_WIDTH_NEW = 4;
    const UPLOAD_LINE_WIDTH_DECIDED = 7;
    const UPLOAD_POINT_RADIUS_NEW = 6;
    const UPLOAD_POINT_RADIUS_DECIDED = 9;

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
        {
            layerIds: ['lr-lines', 'lr-all-lines', UPLOAD_LINE_HIT_LAYER_ID, ALL_LINE_HIT_LAYER_ID],
            geomFilter: GEOM_FILTER_LINE,
        },
        { layerIds: ['lr-fill', 'lr-all-fill'], geomFilter: GEOM_FILTER_POLY },
        { layerIds: ['lr-points', 'lr-all-points'], geomFilter: GEOM_FILTER_POINT },
    ];

    const ICON_APPROVE_SVG =
        '<svg class="lr-action-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
    const ICON_REJECT_SVG =
        '<svg class="lr-action-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    const featureListEl = document.getElementById('lr-feature-list');

    let featureListRequestId = 0;

    const FEATURES_PANEL_MAP_PADDING_PX = 400;
    const BASEMAP_SELECTED_CLASSES = ['ring-2', 'ring-blue-500', 'shadow-lg', 'border-blue-500'];
    const BASEMAP_UNSELECTED_CLASSES = ['border-transparent', 'opacity-80'];
    const ESRI_SATELLITE_BASEMAP_ID = 'esri-satellite';
    const DEFAULT_BASEMAP_MAX_ZOOM = 19;
    const BASEMAP_RASTER_LAYER_MAX_ZOOM = 22;
    const ZOOM_OVERVIEW_MAX = 15;

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
        return Math.min(ZOOM_OVERVIEW_MAX, activeBasemapMaxZoom());
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

    function prepareBasemapForFeatureFocus() {
        const def = basemapDefById(currentBasemapId);
        if (!def || !def.preferSatelliteInZoom) {
            return;
        }
        setBasemap(ESRI_SATELLITE_BASEMAP_ID);
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
                pointStroke: '#ffffff',
            };
        }
        return {
            riyadh: RIYADH_ROADS_LINE_COLOR,
            pointStroke: '#fafafa',
        };
    }

    function uploadFeatureStatusMatch(stagedValue, decidedValue, fallback) {
        return [
            'match',
            ['get', 'status'],
            'nominated',
            decidedValue,
            'rejected_upload',
            decidedValue,
            'staged',
            stagedValue,
            fallback != null ? fallback : stagedValue,
        ];
    }

    function uploadFeatureColorMatch(fallback) {
        return [
            'match',
            ['get', 'status'],
            'nominated',
            UPLOAD_COLOR_APPROVED,
            'rejected_upload',
            UPLOAD_COLOR_REJECTED,
            'staged',
            UPLOAD_COLOR_NEW,
            fallback || UPLOAD_COLOR_NEW,
        ];
    }

    function uploadFeatureLinePaint() {
        return {
            'line-color': uploadFeatureColorMatch(),
            'line-width': uploadFeatureStatusMatch(
                UPLOAD_LINE_WIDTH_NEW,
                UPLOAD_LINE_WIDTH_DECIDED
            ),
            'line-opacity': 0.95,
        };
    }

    function uploadFeatureFillPaint() {
        const color = uploadFeatureColorMatch();
        return {
            'fill-color': color,
            'fill-opacity': 0.15,
            'fill-outline-color': color,
        };
    }

    function uploadFeaturePointPaint(pointStroke) {
        return {
            'circle-radius': uploadFeatureStatusMatch(
                UPLOAD_POINT_RADIUS_NEW,
                UPLOAD_POINT_RADIUS_DECIDED
            ),
            'circle-color': uploadFeatureColorMatch(),
            'circle-stroke-width': 2,
            'circle-stroke-color': pointStroke,
        };
    }

    function uploadFeatureExcludeFilter(geomFilter) {
        if (focusedFeatureId == null) {
            return geomFilter;
        }
        return ['all', geomFilter, ['!=', ['id'], focusedFeatureId]];
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
            if (map.getLayer('lr-points')) {
                map.setPaintProperty('lr-points', 'circle-stroke-color', pal.pointStroke);
            }
            if (map.getLayer('lr-all-points')) {
                map.setPaintProperty('lr-all-points', 'circle-stroke-color', pal.pointStroke);
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
        syncBasemapGallery();
    }

    function syncBasemapGallerySelection(options, selectedId) {
        options.forEach(function (opt) {
            const id = opt.getAttribute('data-basemap-id');
            const isSelected = id === selectedId;
            opt.classList.remove.apply(opt.classList, BASEMAP_SELECTED_CLASSES.concat(BASEMAP_UNSELECTED_CLASSES));
            if (isSelected) {
                BASEMAP_SELECTED_CLASSES.forEach(function (cls) {
                    opt.classList.add(cls);
                });
            } else {
                BASEMAP_UNSELECTED_CLASSES.forEach(function (cls) {
                    opt.classList.add(cls);
                });
            }
        });
    }

    function syncBasemapGallery() {
        const galleryElement = document.getElementById('basemapGallery');
        if (!galleryElement) {
            return;
        }
        const options = galleryElement.querySelectorAll('[data-basemap-id]');
        syncBasemapGallerySelection(options, currentBasemapId);
    }

    function initBasemapControls() {
        const galleryElement = document.getElementById('basemapGallery');
        const toggleButton = document.getElementById('basemapGalleryToggle');
        if (!galleryElement) {
            return;
        }

        const options = galleryElement.querySelectorAll('[data-basemap-id]');
        if (!options.length) {
            return;
        }

        const availableBasemapIds = new Set(
            BASEMAP_DEFINITIONS.map(function (def) {
                return def.id;
            })
        );

        options.forEach(function (option) {
            const basemapId = option.getAttribute('data-basemap-id');
            if (!basemapId || !availableBasemapIds.has(basemapId)) {
                option.setAttribute('disabled', 'true');
                option.classList.add('opacity-50', 'cursor-not-allowed');
                return;
            }
            option.addEventListener('click', function () {
                if (basemapId === currentBasemapId) {
                    return;
                }
                setBasemap(basemapId);
            });
        });

        syncBasemapGallery();

        if (toggleButton) {
            toggleButton.addEventListener('click', function () {
                const isHidden = galleryElement.classList.toggle('hidden');
                toggleButton.setAttribute('aria-expanded', String(!isHidden));
            });
        }

        applyBasemapZoomLimits();
    }

    const selectedFeatureIds = new Set();
    let focusedFeatureId = null;
    const featureGeomById = {};
    const featureStatusById = {};
    let layerExtent = null;
    let statusFilter = '';
    let mapLoadTimer = null;
    let mapLoadInFlight = false;

    const statusFilterEl = document.getElementById('lr-status-filter');

    function ensureRiyadhRoadsSource() {
        if (!HAS_RIYADH_ROADS_TILES || map.getSource(SOURCE_ID_RIYADH)) {
            return;
        }
        const bustedUrl =
            typeof window.buildRiyadhRoadsTileUrl === 'function'
                ? window.buildRiyadhRoadsTileUrl(RIYADH_ROADS_TILE_URL, null)
                : RIYADH_ROADS_TILE_URL;
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

    function reloadRiyadhRoadsTilesOnReviewMap(version) {
        if (!HAS_RIYADH_ROADS_TILES || typeof map === 'undefined' || !map) {
            return;
        }
        if (typeof window.reloadMaplibreVectorTileSource === 'function') {
            window.reloadMaplibreVectorTileSource(
                map,
                SOURCE_ID_RIYADH,
                RIYADH_ROADS_TILE_URL,
                version
            );
        }
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
            try {
                map.resize();
            } catch (e) {
                /* ignore */
            }
            if (typeof afterResize === 'function') {
                afterResize();
            }
        });
    }

    function bindMapResize() {
        const mapHost = document.getElementById('lr-map-workspace');
        resizeMapSoon();
        window.addEventListener('resize', resizeMapSoon);
        if (typeof ResizeObserver !== 'undefined' && mapHost) {
            const observer = new ResizeObserver(function () {
                resizeMapSoon();
            });
            observer.observe(mapHost);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindMapResize);
    } else {
        bindMapResize();
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
        const side = FEATURES_PANEL_MAP_PADDING_PX;
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
        el.classList.remove('lr-feature-card--nominated', 'lr-feature-card--rejected');
        if (status === 'nominated') {
            el.classList.add('lr-feature-card--nominated');
        } else if (status === 'rejected_upload') {
            el.classList.add('lr-feature-card--rejected');
        }
    }

    function fillActionCell(container, status) {
        container.innerHTML = '';

        if (isActionableStatus(status)) {
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'lr-action-btn lr-action-btn--approve lr-action-btn--card';
            approve.setAttribute('aria-label', 'Approve feature');
            approve.setAttribute('title', 'Approve');
            approve.innerHTML = ICON_APPROVE_SVG;

            const reject = document.createElement('button');
            reject.type = 'button';
            reject.className = 'lr-action-btn lr-action-btn--reject lr-action-btn--card';
            reject.setAttribute('aria-label', 'Reject feature');
            reject.setAttribute('title', 'Reject');
            reject.innerHTML = ICON_REJECT_SVG;

            container.appendChild(approve);
            container.appendChild(reject);
            return;
        }

        if (isResetableStatus(status)) {
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'lr-btn-reset lr-btn-reset--compact';
            reset.textContent = 'Reset';
            reset.setAttribute('aria-label', 'Reset to new');
            reset.setAttribute('title', 'Move back to new so you can approve or reject again');
            container.appendChild(reset);
        }
    }

    const STATUS_COUNT_IDS = {
        total: ['lr-cnt-total'],
        staged: ['lr-cnt-staged'],
        nominated: ['lr-cnt-nominated'],
        rejected_upload: ['lr-cnt-rejected_upload'],
    };

    function featureListSelector(fid) {
        return '.lr-feature-card[data-feature-id="' + String(fid) + '"]';
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

    function renderFeatureCount(count) {
        const countEl = document.getElementById('lr-feature-count');
        if (!countEl) {
            return;
        }
        const n = count != null ? count : 0;
        countEl.textContent = n === 1 ? '1 feature' : String(n) + ' features';
    }

    function setFeatureListLoading(loading) {
        if (!featureListEl) {
            return;
        }
        featureListEl.classList.toggle('lr-feature-list--loading', !!loading);
        if (loading) {
            featureListEl.innerHTML =
                '<p class="lr-feature-empty lr-feature-empty--loading">Loading features…</p>';
        }
    }

    function featureListQueryUrl() {
        const params = new URLSearchParams();
        params.set('list', 'all');
        if (statusFilter) {
            params.set('status', statusFilter);
        }
        const join = tableUrl.indexOf('?') >= 0 ? '&' : '?';
        return tableUrl + join + params.toString();
    }

    function loadFeatureList() {
        if (!featureListEl) {
            return Promise.resolve();
        }
        const requestId = ++featureListRequestId;
        setFeatureListLoading(true);
        return fetchReviewJson(featureListQueryUrl())
            .then(function (payload) {
                if (requestId !== featureListRequestId) {
                    return payload;
                }
                if (payload.extent) {
                    layerExtent = payload.extent;
                }
                const feats = payload.features || [];
                feats.forEach(function (f) {
                    if (f.status) {
                        featureStatusById[f.id] = f.status;
                    }
                });
                renderStatusCounts(payload.counts || {});
                renderFeatureList(feats);
                restoreFeatureSelection();
                return payload;
            })
            .catch(function (err) {
                if (requestId !== featureListRequestId) {
                    return;
                }
                featureListEl.innerHTML =
                    '<p class="lr-feature-empty">Could not load features. ' +
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
            if (!Number.isNaN(fid) && props.status) {
                featureStatusById[fid] = props.status;
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

    function geojsonQueryUrl(bbox) {
        if (!bbox) {
            return geojsonUrl;
        }
        const join = geojsonUrl.indexOf('?') >= 0 ? '&' : '?';
        return geojsonUrl + join + 'bbox=' + encodeURIComponent(bbox.join(','));
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
        return Promise.all([refreshMapData(), loadFeatureList()]);
    }

    function syncFeatureCardSelectionUI() {
        document.querySelectorAll('.lr-feature-card[data-feature-id]').forEach(function (el) {
            const id = parseInt(el.getAttribute('data-feature-id'), 10);
            const on = selectedFeatureIds.has(id);
            el.classList.toggle('lr-feature-card--selected', on);
            const check = el.querySelector('.lr-feature-card__check');
            if (check) {
                check.checked = on;
            }
        });
    }

    function updateBulkActionLabels() {
        const btnApprove = document.getElementById('btn-bulk-approve');
        const btnReject = document.getElementById('btn-bulk-reject');
        if (!btnApprove || !btnReject) {
            return;
        }
        const selectedCount = selectedFeatureIds.size;
        const stagedCount = getStagedSelectedIds().length;
        if (selectedCount > 0) {
            const noun = stagedCount === 1 ? 'feature' : 'features';
            btnApprove.textContent = 'Approve ' + String(stagedCount) + ' ' + noun;
            btnReject.textContent = 'Reject ' + String(stagedCount) + ' ' + noun;
            btnApprove.disabled = stagedCount === 0;
            btnReject.disabled = stagedCount === 0;
            return;
        }
        btnApprove.textContent = 'Approve all';
        btnReject.textContent = 'Reject all';
        btnApprove.disabled = false;
        btnReject.disabled = false;
    }

    function getStagedSelectedIds() {
        const ids = [];
        selectedFeatureIds.forEach(function (fid) {
            if (featureStatusById[fid] === 'staged') {
                ids.push(fid);
            }
        });
        return ids;
    }

    function setFeatureSelection(ids, focusId) {
        selectedFeatureIds.clear();
        ids.forEach(function (fid) {
            if (fid != null && !Number.isNaN(fid)) {
                selectedFeatureIds.add(fid);
            }
        });
        focusedFeatureId = focusId != null ? focusId : ids.length ? ids[ids.length - 1] : null;
        syncFeatureCardSelectionUI();
        setSelectionHighlight(focusedFeatureId);
        syncSelectionExclusionFilters();
        updateBulkActionLabels();
    }

    function toggleFeatureSelection(fid, forceOn) {
        const on = forceOn != null ? !!forceOn : !selectedFeatureIds.has(fid);
        if (on) {
            selectedFeatureIds.add(fid);
        } else {
            selectedFeatureIds.delete(fid);
        }
        focusedFeatureId = on ? fid : selectedFeatureIds.size ? Array.from(selectedFeatureIds).slice(-1)[0] : null;
        syncFeatureCardSelectionUI();
        setSelectionHighlight(focusedFeatureId);
        syncSelectionExclusionFilters();
        updateBulkActionLabels();
        if (on) {
            const el = document.querySelector(featureListSelector(fid));
            if (el) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    function clearFeatureSelection() {
        selectedFeatureIds.clear();
        focusedFeatureId = null;
        syncFeatureCardSelectionUI();
        setSelectionHighlight(null);
        syncSelectionExclusionFilters();
        updateBulkActionLabels();
    }

    function restoreFeatureSelection() {
        Array.from(selectedFeatureIds).forEach(function (fid) {
            if (!document.querySelector(featureListSelector(fid))) {
                selectedFeatureIds.delete(fid);
            }
        });
        if (focusedFeatureId != null && !selectedFeatureIds.has(focusedFeatureId)) {
            focusedFeatureId = selectedFeatureIds.size
                ? Array.from(selectedFeatureIds).slice(-1)[0]
                : null;
        }
        if (!selectedFeatureIds.size || focusedFeatureId == null) {
            clearFeatureSelection();
            return;
        }
        syncFeatureCardSelectionUI();
        setSelectionHighlight(focusedFeatureId);
        syncSelectionExclusionFilters();
        updateBulkActionLabels();
        const el = document.querySelector(featureListSelector(focusedFeatureId));
        const ref = rowRefFromElement(el);
        if (ref) {
            zoomToFeature(ref);
            return;
        }
        ensureFeatureGeometry(focusedFeatureId).then(function (geom) {
            if (geom && focusedFeatureId != null) {
                zoomToGeometry(geom);
            }
        });
    }

    function interactiveFeatureLayerIds() {
        const ids = largeLayer ? UPLOAD_LAYER_GROUP : ALL_LAYER_GROUP;
        return ids.filter(function (id) {
            return map.getLayer(id);
        });
    }

    function featureIdFromHit(hit) {
        if (!hit) {
            return NaN;
        }
        if (hit.id != null && hit.id !== '') {
            const fromId = parseInt(String(hit.id), 10);
            if (!Number.isNaN(fromId)) {
                return fromId;
            }
        }
        const props = hit.properties || {};
        if (props.upload_feature_id != null) {
            const fromProp = parseInt(String(props.upload_feature_id), 10);
            if (!Number.isNaN(fromProp)) {
                return fromProp;
            }
        }
        return NaN;
    }

    function queryUploadFeaturesAtPoint(point, layers) {
        if (!point || !layers.length) {
            return [];
        }
        const pad = MAP_FEATURE_CLICK_PAD_PX;
        const box = [
            [point.x - pad, point.y - pad],
            [point.x + pad, point.y + pad],
        ];
        return map.queryRenderedFeatures(box, { layers: layers });
    }

    function addLineHitLayer(hitLayerId, sourceId, filter) {
        if (map.getLayer(hitLayerId)) {
            return;
        }
        map.addLayer({
            id: hitLayerId,
            type: 'line',
            source: sourceId,
            filter: filter,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-width': 16,
                'line-opacity': 0,
            },
        });
    }

    function zoomToGeometry(geom) {
        const bb = boundsFromGeometry(geom);
        if (!bb) {
            return;
        }
        const padded = boundsArea(bb) < 1e-12 ? padBounds(bb, 0.01) : bb;
        try {
            map.fitBounds(new maplibregl.LngLatBounds(padded[0], padded[1]), {
                padding: mapZoomFitPadding(),
                maxZoom: activeBasemapMaxZoom(),
                duration: 750,
            });
        } catch (err) {
            /* ignore */
        }
    }

    function selectFeatureFromUserAction(fid, multiSelect, rowRef, hitGeometry) {
        if (Number.isNaN(fid) || fid == null) {
            return;
        }
        if (hitGeometry) {
            featureGeomById[fid] = hitGeometry;
        }
        if (multiSelect) {
            toggleFeatureSelection(fid);
        } else {
            setFeatureSelection([fid], fid);
            const el = document.querySelector(featureListSelector(fid));
            if (el) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
        prepareBasemapForFeatureFocus();
        if (rowRef) {
            zoomToFeature(rowRef);
            ensureFeatureGeometry(fid).then(function () {
                if (focusedFeatureId === fid) {
                    setSelectionHighlight(fid);
                }
            });
            return;
        }
        if (hitGeometry) {
            zoomToGeometry(hitGeometry);
            setSelectionHighlight(fid);
            return;
        }
        ensureFeatureGeometry(fid).then(function (geom) {
            if (!geom || focusedFeatureId !== fid) {
                return;
            }
            zoomToGeometry(geom);
            setSelectionHighlight(fid);
        });
    }

    function handleUploadFeatureMapPick(e) {
        const layers = interactiveFeatureLayerIds();
        if (!layers.length) {
            return;
        }
        let hits = e.features && e.features.length ? e.features : [];
        if (!hits.length && e.point) {
            hits = queryUploadFeaturesAtPoint(e.point, layers);
        }
        if (!hits.length) {
            return;
        }
        const hit = hits[0];
        const fid = featureIdFromHit(hit);
        if (Number.isNaN(fid)) {
            return;
        }
        const props = hit.properties || {};
        if (props.status) {
            featureStatusById[fid] = props.status;
        }
        const multiSelect = !!(e.originalEvent && (e.originalEvent.metaKey || e.originalEvent.ctrlKey));
        const el = document.querySelector(featureListSelector(fid));
        const ref = rowRefFromElement(el);
        selectFeatureFromUserAction(fid, multiSelect, ref, hit.geometry || null);
    }

    function handleUploadFeatureLayerClick(e) {
        if (!e.features || !e.features.length) {
            return;
        }
        if (e.originalEvent && typeof e.originalEvent.stopPropagation === 'function') {
            e.originalEvent.stopPropagation();
        }
        handleUploadFeatureMapPick(e);
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
                properties: {
                    upload_feature_id: fid,
                    status: featureStatusById[fid] || 'staged',
                },
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
                    paint: uploadFeatureFillPaint(),
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
                    paint: uploadFeatureLinePaint(),
                },
                beforeId
            );
            addLineHitLayer(ALL_LINE_HIT_LAYER_ID, SOURCE_ALL, GEOM_FILTER_LINE);
            map.addLayer(
                {
                    id: 'lr-all-points',
                    type: 'circle',
                    source: SOURCE_ALL,
                    filter: GEOM_FILTER_POINT,
                    layout: { visibility: 'none' },
                    paint: uploadFeaturePointPaint('#fafafa'),
                },
                beforeId
            );
            bindFeatureLayerHandlers();
        } else {
            map.getSource(SOURCE_ALL).setData(data);
            addLineHitLayer(ALL_LINE_HIT_LAYER_ID, SOURCE_ALL, GEOM_FILTER_LINE);
            bindFeatureLayerHandlers();
        }
        moveSelectionLayersToTop();
        syncSelectionExclusionFilters();
    }

    function syncMapFeatureLayers() {
        if (!map.isStyleLoaded()) {
            return;
        }
        if (largeLayer) {
            setLayerGroupVisibility(UPLOAD_LAYER_GROUP, true);
            setLayerGroupVisibility(ALL_LAYER_GROUP, false);
            return;
        }
        ensureAllFeaturesSourceAndLayers();
        setLayerGroupVisibility(UPLOAD_LAYER_GROUP, false);
        setLayerGroupVisibility(ALL_LAYER_GROUP, true);
    }

    function zoomToAllFeatures() {
        const extentMaxZoom = overviewFitMaxZoom();
        if (layerExtent) {
            const padded =
                boundsArea(layerExtent) < 1e-12 ? padBounds(layerExtent, 0.01) : layerExtent;
            try {
                map.fitBounds(new maplibregl.LngLatBounds(padded[0], padded[1]), {
                    padding: mapZoomFitPadding(),
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
                padding: mapZoomFitPadding(),
                maxZoom: extentMaxZoom,
                duration: 900,
            });
        } catch (e) {
            /* ignore */
        }
    }

    function zoomToFeature(row) {
        prepareBasemapForFeatureFocus();
        const focusMaxZoom = activeBasemapMaxZoom();
        let bb = row.bbox;
        const center = row.center;
        const geom = row.geometry;
        const fitPadding = mapZoomFitPadding();

        if (!bb || !Array.isArray(bb) || bb.length !== 2) {
            bb = geom ? boundsFromGeometry(geom) : null;
        }

        if (bb && boundsArea(bb) < 1e-10) {
            bb = padBounds(bb, 0.002);
        }

        if (center && Array.isArray(center) && center.length === 2 && (!bb || boundsArea(bb) < 1e-16)) {
            map.easeTo({
                center: center,
                zoom: focusMaxZoom,
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
            if (!geom || focusedFeatureId !== fid) {
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
                paint: uploadFeatureLinePaint(),
            });
        }
        addLineHitLayer(UPLOAD_LINE_HIT_LAYER_ID, SOURCE_STAGING, GEOM_FILTER_LINE);
        if (!map.getLayer('lr-fill')) {
            map.addLayer({
                id: 'lr-fill',
                type: 'fill',
                source: SOURCE_STAGING,
                filter: GEOM_FILTER_POLY,
                paint: uploadFeatureFillPaint(),
            });
        }
        if (!map.getLayer('lr-points')) {
            map.addLayer({
                id: 'lr-points',
                type: 'circle',
                source: SOURCE_STAGING,
                filter: GEOM_FILTER_POINT,
                paint: uploadFeaturePointPaint('#fafafa'),
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

    const boundMapLayerHandlers = {};

    function bindFeatureLayerHandlers() {
        UPLOAD_LAYER_GROUP.concat(ALL_LAYER_GROUP).forEach(function (layerId) {
            if (!map.getLayer(layerId) || boundMapLayerHandlers[layerId]) {
                return;
            }
            boundMapLayerHandlers[layerId] = true;
            map.on('mouseenter', layerId, function () {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layerId, function () {
                map.getCanvas().style.cursor = '';
            });
            map.on('click', layerId, handleUploadFeatureLayerClick);
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

    function wireFeatureInteractions(el, f, rowRef) {
        const check = el.querySelector('.lr-feature-card__check');
        if (check) {
            check.addEventListener('click', function (e) {
                e.stopPropagation();
            });
            check.addEventListener('change', function () {
                toggleFeatureSelection(f.id, check.checked);
                if (check.checked) {
                    ensureFeatureGeometry(f.id).then(function () {
                        if (focusedFeatureId === f.id) {
                            setSelectionHighlight(f.id);
                        }
                    });
                }
            });
        }

        el.addEventListener('click', function (e) {
            if (e.target.closest('.lr-action-btn, .lr-btn-reset, .lr-feature-card__check')) {
                return;
            }
            selectFeatureFromUserAction(f.id, e.metaKey || e.ctrlKey, rowRef, null);
        });

        const approve = el.querySelector('.lr-action-btn--approve');
        const reject = el.querySelector('.lr-action-btn--reject');
        const reset = el.querySelector('.lr-btn-reset');
        if (approve) {
            approve.addEventListener('click', function (e) {
                e.stopPropagation();
                postFeatureAction('nominate', f.id, 'Approve');
            });
        }
        if (reject) {
            reject.addEventListener('click', function (e) {
                e.stopPropagation();
                postFeatureAction('reject', f.id, 'Reject');
            });
        }
        if (reset) {
            reset.addEventListener('click', function (e) {
                e.stopPropagation();
                postFeatureAction('reset', f.id, 'Reset');
            });
        }
    }

    function buildFeatureCard(f) {
        const card = document.createElement('article');
        card.className = 'lr-feature-card';
        card.setAttribute('role', 'listitem');
        stampFeatureDataset(card, f);

        const body = document.createElement('div');
        body.className = 'lr-feature-card__body';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'lr-feature-card__check';
        check.setAttribute('aria-label', 'Select feature');
        check.checked = selectedFeatureIds.has(f.id);

        const info = document.createElement('div');
        info.className = 'lr-feature-card__info';
        info.innerHTML = renderFeatureSummary(f);

        const aside = document.createElement('div');
        aside.className = 'lr-feature-card__aside';

        const statusWrap = document.createElement('div');
        statusWrap.className = 'lr-feature-card__status';
        statusWrap.innerHTML = statusBadge(f.status);

        const actions = document.createElement('div');
        actions.className = 'lr-feature-card__actions';
        fillActionCell(actions, f.status);

        aside.appendChild(statusWrap);
        aside.appendChild(actions);
        body.appendChild(check);
        body.appendChild(info);
        body.appendChild(aside);
        card.appendChild(body);
        applyFeatureStatusClasses(card, f.status);
        wireFeatureInteractions(card, f, featureRowRef(f));
        return card;
    }

    function renderFeatureList(feats) {
        if (!featureListEl) {
            return;
        }
        const list = feats || [];
        renderFeatureCount(list.length);
        featureListEl.classList.remove('lr-feature-list--loading');
        featureListEl.innerHTML = '';
        if (!list.length) {
            featureListEl.innerHTML =
                '<p class="lr-feature-empty">No features match the current filter.</p>';
            return;
        }
        const fragment = document.createDocumentFragment();
        list.forEach(function (f) {
            fragment.appendChild(buildFeatureCard(f));
        });
        featureListEl.appendChild(fragment);
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
        nominated: 'Approved',
        rejected_upload: 'Rejected',
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

    function renderFeatureSummary(f) {
        const name = f.road_name != null ? String(f.road_name).trim() : '';
        const nameClass = name ? 'lr-feature-card__name' : 'lr-feature-card__name lr-feature-card__name--empty';
        const nameText = name || 'Unnamed road';
        const osmId = f.osm_id != null ? String(f.osm_id).trim() : '';
        const osmText = osmId || '—';
        return (
            '<span class="lr-feature-card__label">Road Name</span>' +
            '<span class="' +
            nameClass +
            '">' +
            escapeHtml(nameText) +
            '</span>' +
            '<span class="lr-feature-card__label">Osm Id</span>' +
            '<span class="lr-feature-card__osm">' +
            escapeHtml(osmText) +
            '</span>'
        );
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function initReviewData() {
        return loadFeatureList()
            .then(function () {
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
        resizeMapSoon();
        initBasemapControls();
        ensureRiyadhRoadsSource();
        addRiyadhPublicRoadLayer();
        if (typeof window.registerRiyadhRoadsTileReloader === 'function') {
            window.registerRiyadhRoadsTileReloader(reloadRiyadhRoadsTilesOnReviewMap);
        }

        map.on('click', handleUploadFeatureMapPick);
        map.on('moveend', function () {
            if (largeLayer) {
                scheduleMapReload();
            }
        });

        if (statusFilterEl) {
            statusFilterEl.addEventListener('change', function () {
                statusFilter = statusFilterEl.value || '';
                loadFeatureList().catch(function () {
                    window.notify.tryShow('Failed to load features.', 'error');
                });
            });
        }

        initReviewData().then(function () {
            resizeMapSoon(zoomToAllFeatures);
        });
    });

    function runBulkAction(action, errorMessage, extraPayload) {
        const payload = Object.assign({ action: action }, extraPayload || {});
        return postAction(payload)
            .then(function () {
                clearFeatureSelection();
                return refreshAfterMutation();
            })
            .catch(function (err) {
                window.notify.tryShow(err.message || errorMessage, 'error');
            });
    }

    const btnBulkApprove = document.getElementById('btn-bulk-approve');
    const btnBulkReject = document.getElementById('btn-bulk-reject');
    if (btnBulkApprove) {
        btnBulkApprove.addEventListener('click', function () {
            const stagedIds = getStagedSelectedIds();
            if (selectedFeatureIds.size > 0) {
                if (!stagedIds.length) {
                    return;
                }
                runBulkAction('nominate_selected', 'Could not approve selected features', {
                    feature_ids: stagedIds,
                });
                return;
            }
            runBulkAction('nominate_all', 'Could not approve all features');
        });
    }
    if (btnBulkReject) {
        btnBulkReject.addEventListener('click', function () {
            const stagedIds = getStagedSelectedIds();
            if (selectedFeatureIds.size > 0) {
                if (!stagedIds.length) {
                    return;
                }
                runBulkAction('reject_selected', 'Could not reject selected features', {
                    feature_ids: stagedIds,
                });
                return;
            }
            runBulkAction('reject_all', 'Could not reject all features');
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
                if (typeof window.applyLiveNetworkEditToMap === 'function') {
                    window.applyLiveNetworkEditToMap(payload, { reloadDelayMs: 0 });
                }
                if (payload.redirect_url) {
                    const delay = payload && payload.tiles_version ? 400 : 0;
                    setTimeout(function () {
                        window.location.href = payload.redirect_url;
                    }, delay);
                }
            })
            .catch(function (err) {
                window.notify.tryShow(err.message || 'Could not submit layer', 'error');
            });
    }

    const btnSubmit = document.getElementById('btn-submit-manager');
    if (btnSubmit && submitUrl) {
        btnSubmit.addEventListener('click', function () {
            const nominatedEl = document.getElementById('lr-cnt-nominated');
            const nominatedCount = nominatedEl ? parseInt(nominatedEl.textContent, 10) : 0;
            if (!nominatedCount || Number.isNaN(nominatedCount)) {
                window.notify.tryShow(
                    isManagerUploader
                        ? 'Approve at least one road before publishing.'
                        : 'Approve at least one road before submitting.',
                    'warning'
                );
                return;
            }
            const confirmMsg = isManagerUploader
                ? 'Publish ' + nominatedCount + ' approved road(s) to the map now? This cannot be undone.'
                : 'Submit ' + nominatedCount + ' approved road(s) for review? You will not be able to edit this layer afterward.';
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
