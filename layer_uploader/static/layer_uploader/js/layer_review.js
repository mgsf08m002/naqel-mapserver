(function () {
    const root = document.getElementById('layer-review-root');
    const mapEl = document.getElementById('review-map');
    if (!root || !mapEl || typeof maplibregl === 'undefined') {
        return;
    }

    const geojsonUrl = root.dataset.geojsonUrl;
    const tableUrl = root.dataset.tableUrl;
    const actionUrl = root.dataset.actionUrl;

    const MAPTILER_API_KEY = (root.dataset.maptilerApiKey || '').trim();
    const HAS_MAPTILER = MAPTILER_API_KEY.length > 0;
    const RIYADH_ROADS_TILE_URL = (root.dataset.riyadhRoadsTileUrl || '').trim();
    const HAS_RIYADH_ROADS_TILES = RIYADH_ROADS_TILE_URL.length > 0;

    const MAP_GLYPHS_URL = HAS_MAPTILER
        ? 'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=' + MAPTILER_API_KEY
        : 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

    const RIYADH_PUBLIC_ROAD_LINE_COLOR = '#e3d1a3';
    const SOURCE_ID_RIYADH = 'riyadh-roads';
    const PUBLIC_LAYER_ID_RIYADH = 'riyadh-roads-public-layer';
    const SOURCE_LAYER_RIYADH = 'riyadh_roads';
    const SOURCE_UPLOAD = 'lr-upload-approved';

    const APPROVED_LINE_COLOR = '#1d4ed8';

    const bounds = [
        [45.475, 23.981],
        [48.733, 25.664],
    ];

    function getDefaultRiyadhTilesVersion() {
        return String(Date.now());
    }

    function buildCacheBustedUrl(baseUrl, version) {
        if (!baseUrl) {
            return baseUrl;
        }
        const v = version != null && String(version).trim().length ? String(version).trim() : getDefaultRiyadhTilesVersion();
        const sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
        return baseUrl + sep + 'v=' + encodeURIComponent(v);
    }

    const BASEMAP_DEFINITIONS = (function () {
        const definitions = [
            {
                id: 'esri-satellite',
                sourceId: 'basemap-esri-satellite-source',
                layerId: 'basemap-esri-satellite-layer',
                tileUrl:
                    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            },
        ];
        if (HAS_MAPTILER) {
            const maptilerBaseUrl = 'https://api.maptiler.com/maps';
            definitions.push({
                id: 'maptiler-streets',
                sourceId: 'basemap-maptiler-streets-source',
                layerId: 'basemap-maptiler-streets-layer',
                tileUrl:
                    maptilerBaseUrl + '/streets-v2/256/{z}/{x}/{y}.png?key=' + MAPTILER_API_KEY,
            });
        }
        return definitions;
    })();

    let currentBasemapId = HAS_MAPTILER ? 'maptiler-streets' : 'esri-satellite';

    const baseSources = {};
    const baseLayers = [];
    BASEMAP_DEFINITIONS.forEach(function (def) {
        baseSources[def.sourceId] = {
            type: 'raster',
            tiles: [def.tileUrl],
            tileSize: 256,
            maxzoom: 19,
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
        container: 'review-map',
        center: [46.727866, 24.72358],
        zoom: 9.5,
        maxZoom: 19,
        maxBounds: bounds,
        style: {
            version: 8,
            glyphs: MAP_GLYPHS_URL,
            sources: baseSources,
            layers: baseLayers,
        },
    });

    map.addControl(
        new maplibregl.NavigationControl({
            visualizePitch: true,
            visualizeRoll: true,
            showZoom: true,
            showCompass: true,
        })
    );

    function ensureRiyadhRoadsSource() {
        if (!HAS_RIYADH_ROADS_TILES || map.getSource(SOURCE_ID_RIYADH)) {
            return;
        }
        const bustedUrl = buildCacheBustedUrl(RIYADH_ROADS_TILE_URL, getDefaultRiyadhTilesVersion());
        map.addSource(SOURCE_ID_RIYADH, {
            type: 'vector',
            tiles: [bustedUrl],
            minzoom: 0,
            maxzoom: 14,
            promoteId: (function () {
                const o = {};
                o[SOURCE_LAYER_RIYADH] = 'id';
                return o;
            })(),
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
                'line-color': RIYADH_PUBLIC_ROAD_LINE_COLOR,
                'line-width': 2,
                'line-opacity': 1,
            },
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
                    'line-color': APPROVED_LINE_COLOR,
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
                    'fill-color': APPROVED_LINE_COLOR,
                    'fill-opacity': 0.12,
                    'fill-outline-color': APPROVED_LINE_COLOR,
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
                    'circle-radius': 7,
                    'circle-color': APPROVED_LINE_COLOR,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                },
            });
        }
        bindUploadFeatureHoverHandlers();
    }

    function bindUploadFeatureHoverHandlers() {
        if (window.__naqelLrHoverBound) {
            return;
        }
        window.__naqelLrHoverBound = true;
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
        const rows = document.querySelectorAll('#review-feature-rows tr[data-feature-id]');
        rows.forEach(function (tr) {
            const id = parseInt(tr.getAttribute('data-feature-id'), 10);
            const on = id === fid;
            tr.classList.toggle('bg-blue-50', on);
            tr.classList.toggle('ring-2', on);
            tr.classList.toggle('ring-inset', on);
            tr.classList.toggle('ring-blue-400', on);
        });
    }

    function zoomToFeature(row) {
        const bb = row.bbox;
        const dx = bb[1][0] - bb[0][0];
        const dy = bb[1][1] - bb[0][1];
        if (!bb || (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12)) {
            map.easeTo({ center: row.center, zoom: 16, duration: 700 });
            return;
        }
        map.fitBounds(bb, { padding: 56, maxZoom: 17, duration: 850 });
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
                        throw new Error(j.detail || j.error || r.statusText);
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
            return '<span class="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Approved</span>';
        }
        if (status === 'rejected') {
            return '<span class="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">Rejected</span>';
        }
        return '<span class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Pending</span>';
    }

    function renderTable(payload) {
        const tbody = document.getElementById('review-feature-rows');
        if (!tbody) {
            return;
        }
        renderCounts(payload.counts || {});

        const feats = payload.features || [];
        tbody.innerHTML = '';
        if (!feats.length) {
            tbody.innerHTML =
                '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-500 text-sm">No new features were found for this upload. You can still finish.</td></tr>';
            return;
        }

        feats.forEach(function (f, idx) {
            const tr = document.createElement('tr');
            tr.className =
                'cursor-pointer border-t border-gray-100 hover:bg-gray-50 transition';
            tr.dataset.featureId = String(f.id);
            tr.dataset.bboxEnc = encodeURIComponent(JSON.stringify(f.bbox));
            tr.dataset.centerEnc = encodeURIComponent(JSON.stringify(f.center));

            const tdNum = document.createElement('td');
            tdNum.className = 'px-4 py-3 align-top text-gray-700';
            tdNum.textContent = String(idx + 1);

            const tdSt = document.createElement('td');
            tdSt.className = 'px-4 py-3 align-top';
            tdSt.innerHTML = statusBadge(f.status);

            const tdPrev = document.createElement('td');
            tdPrev.className = 'px-4 py-3 align-top text-gray-700 max-w-md break-words';
            tdPrev.textContent = f.properties_preview ? String(f.properties_preview) : '—';

            const tdAct = document.createElement('td');
            tdAct.className = 'px-4 py-3 align-top text-right whitespace-nowrap';
            const bA = document.createElement('button');
            bA.type = 'button';
            bA.className =
                'lr-ap mr-1 inline-flex rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700';
            bA.dataset.fid = String(f.id);
            bA.textContent = 'Approve';
            const bR = document.createElement('button');
            bR.type = 'button';
            bR.className =
                'lr-rj inline-flex rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700';
            bR.dataset.fid = String(f.id);
            bR.textContent = 'Reject';
            tdAct.appendChild(bA);
            tdAct.appendChild(bR);

            tr.appendChild(tdNum);
            tr.appendChild(tdSt);
            tr.appendChild(tdPrev);
            tr.appendChild(tdAct);

            tr.addEventListener('click', function (e) {
                if (e.target.closest('.lr-ap') || e.target.closest('.lr-rj')) {
                    return;
                }
                const fid = parseInt(tr.dataset.featureId, 10);
                setRowSelected(fid);
                try {
                    const bbox = JSON.parse(decodeURIComponent(tr.dataset.bboxEnc));
                    const center = JSON.parse(decodeURIComponent(tr.dataset.centerEnc));
                    zoomToFeature({ bbox: bbox, center: center });
                } catch (err) {
                    /* ignore */
                }
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
    }

    function refreshAll() {
        return Promise.all([fetchReviewJson(geojsonUrl), fetchReviewJson(tableUrl)])
            .then(function (results) {
                setUploadSourceData(results[0]);
                renderTable(results[1]);
            })
            .catch(function () {
                window.alert('Failed to refresh data.');
            });
    }

    map.on('load', function () {
        BASEMAP_DEFINITIONS.forEach(function (def) {
            if (map.getLayer(def.layerId)) {
                map.setLayoutProperty(def.layerId, 'visibility', def.id === currentBasemapId ? 'visible' : 'none');
            }
        });

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
            const tr = document.querySelector('#review-feature-rows tr[data-feature-id="' + String(fid) + '"]');
            if (tr && tr.dataset.bboxEnc && tr.dataset.centerEnc) {
                try {
                    const bbox = JSON.parse(decodeURIComponent(tr.dataset.bboxEnc));
                    const center = JSON.parse(decodeURIComponent(tr.dataset.centerEnc));
                    zoomToFeature({ bbox: bbox, center: center });
                    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } catch (err) {
                    /* ignore */
                }
            }
        });

        refreshAll();
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
