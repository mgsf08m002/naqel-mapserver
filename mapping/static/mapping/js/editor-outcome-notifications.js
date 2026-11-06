// Editor header bell: unread approve/reject outcomes for the signed-in editor.
(function () {
    'use strict';

    var POLL_MS = 30000;
    var outcomes = [];
    var pollTimer = null;

    function uiT(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    function getCookie(name) {
        if (!document.cookie) {
            return null;
        }
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === name + '=') {
                return decodeURIComponent(cookie.substring(name.length + 1));
            }
        }
        return null;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function wrap() {
        return document.getElementById('editorOutcomeBellWrap');
    }

    function bellBtn() {
        return document.getElementById('editorOutcomeBell');
    }

    function panel() {
        return document.getElementById('editorOutcomePanel');
    }

    function listEl() {
        return document.getElementById('editorOutcomeList');
    }

    function badgeEl() {
        return document.getElementById('editorOutcomeBellBadge');
    }

    function setPanelOpen(open) {
        var p = panel();
        var btn = bellBtn();
        if (!p || !btn) {
            return;
        }
        p.classList.toggle('editor-outcome-panel--open', !!open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function isPanelOpen() {
        var p = panel();
        return !!(p && p.classList.contains('editor-outcome-panel--open'));
    }

    function syncChrome() {
        var w = wrap();
        if (!w) {
            return;
        }
        var n = outcomes.length;
        w.classList.toggle('is-visible', n > 0);
        if (n === 0) {
            setPanelOpen(false);
        }

        var badge = badgeEl();
        if (badge) {
            badge.textContent = String(n);
            var hasReject = outcomes.some(function (item) {
                return item.status === 'rejected';
            });
            badge.classList.toggle(
                'editor-outcome-bell__badge--has-reject',
                hasReject
            );
            badge.setAttribute('aria-hidden', n ? 'false' : 'true');
        }
    }

    function featureTypeLabel(item) {
        var featureType = String(item.current_feature_label || '').trim();
        if (
            featureType &&
            typeof window.displayFeatureTypeLabel === 'function'
        ) {
            return window.displayFeatureTypeLabel(featureType);
        }
        return featureType;
    }

    function categoryLabel(item) {
        var key = item.request_category || '';
        if (!key) {
            return item.request_category_label || '';
        }
        return uiT(
            'approval_cat_' + key,
            item.request_category_label || key
        );
    }

    function fieldHtml(label, value, opts) {
        opts = opts || {};
        return (
            '<div class="editor-outcome-row__field">' +
            '<span class="editor-outcome-row__field-label">' +
            escapeHtml(label) +
            '</span>' +
            '<p class="editor-outcome-row__field-value"' +
            (opts.dirAuto ? ' dir="auto"' : '') +
            '>' +
            escapeHtml(value) +
            '</p></div>'
        );
    }

    function buildMetaHtml(item) {
        var roadName =
            String(item.road_name || '').trim() ||
            uiT('unnamed_road', 'Unnamed Road');
        var editType = categoryLabel(item);
        var featureType = featureTypeLabel(item);
        if (featureType && featureType === roadName) {
            featureType = '';
        }

        var html =
            '<div class="editor-outcome-row__meta">' +
            fieldHtml(uiT('outcome_road_label', 'Road'), roadName, {
                dirAuto: true,
            });
        if (editType) {
            html += fieldHtml(
                uiT('approval_meta_edit_type', 'Edit type'),
                editType
            );
        }
        if (featureType) {
            html += fieldHtml(uiT('feature_type', 'Feature type'), featureType);
        }
        return html + '</div>';
    }

    function buildReasonHtml(item) {
        if (item.status === 'approved') {
            return '';
        }
        var reason = String(item.rejection_reason || '').trim();
        if (item.no_reason || !reason) {
            return (
                '<p class="editor-outcome-row__reason--empty">' +
                escapeHtml(uiT('outcome_no_reason_given', 'No reason given')) +
                '</p>'
            );
        }
        return (
            '<div class="editor-outcome-row__reason">' +
            '<span class="editor-outcome-row__reason-label">' +
            escapeHtml(uiT('outcome_reason_label', 'Reason')) +
            '</span>' +
            '<p class="editor-outcome-row__reason-text" dir="auto">' +
            escapeHtml(reason) +
            '</p></div>'
        );
    }

    function renderList() {
        var list = listEl();
        if (!list) {
            return;
        }
        list.innerHTML = '';
        if (!outcomes.length) {
            return;
        }

        outcomes.forEach(function (item) {
            var approved = item.status === 'approved';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'listitem');
            btn.className =
                'editor-outcome-row ' +
                (approved
                    ? 'editor-outcome-row--approved'
                    : 'editor-outcome-row--rejected');

            btn.innerHTML =
                '<span class="editor-outcome-row__status">' +
                escapeHtml(
                    approved
                        ? uiT('outcome_approved', 'Approved')
                        : uiT('outcome_rejected', 'Not approved')
                ) +
                '</span>' +
                '<p class="editor-outcome-row__title">' +
                escapeHtml(
                    approved
                        ? uiT(
                              'outcome_approved_title',
                              'Your edit was approved'
                          )
                        : uiT(
                              'outcome_rejected_title',
                              'Your edit was not approved'
                          )
                ) +
                '</p>' +
                buildMetaHtml(item) +
                buildReasonHtml(item);

            btn.addEventListener('click', function () {
                handleOutcomeClick(item);
            });
            list.appendChild(btn);
        });
    }

    function openRoadOnMap(roadId) {
        if (roadId == null || roadId === '') {
            return;
        }
        var mapReady =
            document.getElementById('map') &&
            window.geotrakMaplibreMap &&
            typeof window.openRiyadhRoadById === 'function';
        if (mapReady) {
            Promise.resolve(
                window.openRiyadhRoadById(roadId, null, {
                    enterEditMode: false,
                })
            )
                .then(function (result) {
                    var road = result && result.road;
                    if (
                        road &&
                        road.geometry &&
                        typeof window.geotrakZoomToRoadGeometry === 'function'
                    ) {
                        window.geotrakZoomToRoadGeometry(road.geometry);
                    }
                })
                .catch(function () {});
            return;
        }
        window.location.href =
            '/editor/?road=' + encodeURIComponent(String(roadId));
    }

    function markRead(requestId) {
        return fetch(
            '/mapping/api/editor-outcome-notifications/' +
                requestId +
                '/read/',
            {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken') || '',
                    Accept: 'application/json',
                },
                credentials: 'same-origin',
            }
        ).then(function (response) {
            return response.json().catch(function () {
                return { success: response.ok };
            });
        });
    }

    function handleOutcomeClick(item) {
        if (!item || item.id == null) {
            return;
        }
        var roadId = item.can_open_on_map ? item.map_road_id : null;
        markRead(item.id)
            .then(function () {
                outcomes = outcomes.filter(function (row) {
                    return row.id !== item.id;
                });
                syncChrome();
                renderList();
                setPanelOpen(false);
                if (roadId != null) {
                    openRoadOnMap(roadId);
                }
            })
            .catch(function () {
                if (
                    window.notify &&
                    typeof window.notify.tryShow === 'function'
                ) {
                    window.notify.tryShow(
                        uiT(
                            'outcome_mark_read_failed',
                            "Couldn't update that notification"
                        ),
                        'error'
                    );
                }
            });
    }

    function applyPayload(data) {
        outcomes = Array.isArray(data && data.notifications)
            ? data.notifications
            : [];
        syncChrome();
        renderList();
    }

    function refreshOutcomes() {
        return fetch('/mapping/api/editor-outcome-notifications/', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('outcome fetch failed');
                }
                return response.json();
            })
            .then(applyPayload)
            .catch(function () {});
    }

    function bindUi() {
        var btn = bellBtn();
        var p = panel();
        if (!btn || !p) {
            return;
        }
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            setPanelOpen(!isPanelOpen());
            if (isPanelOpen()) {
                refreshOutcomes();
            }
        });
        document.addEventListener('click', function (e) {
            var w = wrap();
            if (!w || !isPanelOpen()) {
                return;
            }
            if (!w.contains(e.target)) {
                setPanelOpen(false);
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isPanelOpen()) {
                setPanelOpen(false);
            }
        });
    }

    function startPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        pollTimer = setInterval(refreshOutcomes, POLL_MS);
    }

    function init() {
        if (!wrap()) {
            return;
        }
        bindUi();
        syncChrome();
        refreshOutcomes();
        startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
