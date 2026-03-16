(function () {
    'use strict';

    function isAuthenticated() {
        try {
            if (typeof IS_AUTHENTICATED !== 'undefined') return !!IS_AUTHENTICATED;
        } catch (e) {}
        const mapEl = document.getElementById('map');
        if (!mapEl) return true;
        return mapEl.getAttribute('data-is-authenticated') !== 'false';
    }

    function redirectToLogin() {
        const next = encodeURIComponent(
            window.location.pathname + window.location.search + window.location.hash
        );
        window.location.href = `/login/?next=${next}`;
    }

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function attachPublicTileRoadRedirect() {
        if (typeof map === 'undefined' || !map) return;
        if (!map.getLayer('riyadh-roads-public-layer')) return;

        try {
            map.on('click', 'riyadh-roads-public-layer', function () {
                redirectToLogin();
            });
            map.on('mouseenter', 'riyadh-roads-public-layer', function () {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'riyadh-roads-public-layer', function () {
                map.getCanvas().style.cursor = '';
            });
        } catch (e) {}
    }

    function init() {
        if (typeof map === 'undefined' || !map) {
            setTimeout(init, 100);
            return;
        }
        map.on('load', function () {
            attachPublicTileRoadRedirect();
        });
        map.on('style.load', function () {
            attachPublicTileRoadRedirect();
        });
        if (map.loaded()) {
            attachPublicTileRoadRedirect();
        }
    }

    init();
})();

