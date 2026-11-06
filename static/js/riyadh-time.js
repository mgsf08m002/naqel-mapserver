/**
 * Shared Asia/Riyadh (Saudi Arabia) display helpers for the browser.
 * Absolute wall-clock formatting must always use this module - never the
 * browser's local timezone.
 *
 * Locale follows the UI language on <html lang="en|ar">.
 */
(function (global) {
    'use strict';

    var RIYADH_TZ = 'Asia/Riyadh';

    function uiLocale() {
        var lang = '';
        try {
            lang = (document.documentElement && document.documentElement.lang) || '';
        } catch (err) {
            lang = '';
        }
        lang = String(lang).toLowerCase();
        if (lang.indexOf('ar') === 0) {
            // Arabic month/period labels, Latin digits (common for admin UIs).
            return 'ar-SA-u-nu-latn';
        }
        return 'en-GB';
    }

    function formatRiyadhDateTime(iso, fallback) {
        if (!iso) return fallback != null ? fallback : '';
        var date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return fallback != null ? fallback : String(iso);
        }
        return date.toLocaleString(uiLocale(), {
            timeZone: RIYADH_TZ,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    }

    function formatRiyadhDate(iso, fallback) {
        if (!iso) return fallback != null ? fallback : '';
        var date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return fallback != null ? fallback : String(iso);
        }
        return date.toLocaleDateString(uiLocale(), {
            timeZone: RIYADH_TZ,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    }

    function formatRiyadhClock(iso, fallback) {
        if (!iso) return fallback != null ? fallback : '';
        var date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return fallback != null ? fallback : String(iso);
        }
        return date.toLocaleTimeString(uiLocale(), {
            timeZone: RIYADH_TZ,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    }

    global.RIYADH_TZ = RIYADH_TZ;
    global.formatRiyadhDateTime = formatRiyadhDateTime;
    global.formatRiyadhDate = formatRiyadhDate;
    global.formatRiyadhClock = formatRiyadhClock;
})(typeof window !== 'undefined' ? window : this);
