/**
 * Shared toast + confirm UI (`window.notify`).
 *
 * Also exposes ``window.safeUserMessage`` so technical / unexpected errors
 * never reach the UI - only curated copy (or a localized fallback).
 */
(function () {
    'use strict';

    var TECHNICAL_MESSAGE_RE = new RegExp(
        [
            'traceback',
            '\\bexception\\b',
            'psycopg',
            'operationalerror',
            'integrityerror',
            'programmingerror',
            'doesnotexist',
            'geosgeometry',
            'django\\.',
            'at 0x[0-9a-f]+',
            'failed to apply',
            'error saving',
            'error fetching',
            'error approving',
            'error rejecting',
            'error loading',
            'could not update road closure on the network',
            'remote network',
            'internal server error',
            'bad gateway',
            'service unavailable',
            'failed to fetch',
            'networkerror',
            'syntaxerror',
            'typeerror',
            'referenceerror',
            'stack trace',
            'file ".*", line',
            'line \\d+, in ',
        ].join('|'),
        'i'
    );

    function extractMessage(source) {
        if (source == null) {
            return '';
        }
        if (typeof source === 'string') {
            return source;
        }
        if (source instanceof Error) {
            return source.message || '';
        }
        if (typeof source === 'object') {
            if (source.message != null && String(source.message).trim()) {
                return String(source.message);
            }
            if (source.detail != null && String(source.detail).trim()) {
                return String(source.detail);
            }
        }
        return '';
    }

    function looksTechnical(message) {
        var text = String(message || '').trim();
        if (!text) {
            return true;
        }
        return TECHNICAL_MESSAGE_RE.test(text);
    }

    function defaultSafeFallback() {
        if (typeof window.uiT === 'function') {
            return window.uiT('generic_error', 'Something went wrong. Try again.');
        }
        return 'Something went wrong. Try again.';
    }

    /**
     * Return a user-safe message.
     * Curated copy passes through; technical/empty text becomes ``fallback``.
     */
    function safeUserMessage(source, fallback) {
        var text = extractMessage(source).trim();
        var safeFallback =
            fallback != null && String(fallback).trim()
                ? String(fallback)
                : defaultSafeFallback();
        if (!text || looksTechnical(text)) {
            return safeFallback;
        }
        return text;
    }

    window.safeUserMessage = safeUserMessage;

    var TYPE_LABEL_KEYS = {
        success: 'toast_type_success',
        error: 'toast_type_error',
        warning: 'toast_type_warning',
        info: 'toast_type_info',
    };

    var TYPE_LABEL_FALLBACKS = {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Info',
    };

    function typeLabel(type) {
        var key = TYPE_LABEL_KEYS[type] || TYPE_LABEL_KEYS.info;
        var fallback = TYPE_LABEL_FALLBACKS[type] || TYPE_LABEL_FALLBACKS.info;
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback;
    }

    function dismissLabel() {
        if (typeof window.uiT === 'function') {
            return window.uiT('toast_dismiss', 'Dismiss notification');
        }
        return 'Dismiss notification';
    }

    var ICONS = {
        success:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="9" stroke-width="1.75"/>' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M8.5 12.5l2.4 2.4 4.6-5"/>' +
            '</svg>',
        error:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="9" stroke-width="1.75"/>' +
            '<path stroke-linecap="round" stroke-width="1.75" d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>' +
            '</svg>',
        warning:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path stroke-linejoin="round" stroke-width="1.75" d="M12 3.8L21.2 20H2.8L12 3.8z"/>' +
            '<path stroke-linecap="round" stroke-width="1.75" d="M12 10v4.2"/>' +
            '<circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>' +
            '</svg>',
        info:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="9" stroke-width="1.75"/>' +
            '<path stroke-linecap="round" stroke-width="1.75" d="M12 11.2V16"/>' +
            '<circle cx="12" cy="8.2" r="0.9" fill="currentColor" stroke="none"/>' +
            '</svg>',
    };

    function normalizeType(type) {
        var t = String(type || 'info').toLowerCase();
        if (t === 'danger' || t === 'failure') {
            return 'error';
        }
        return TYPE_LABEL_KEYS[t] ? t : 'info';
    }

    function NotificationSystem() {
        this.container = null;
        this.template = null;
        this.autoHideDelay = 7000;
        this._confirmDialog = null;
        this._confirmTitle = null;
        this._confirmMessage = null;
        this._confirmOkBtn = null;
        this._confirmCancelBtn = null;
        this._confirmBackdrop = null;
        this._confirmResolve = null;
        this._confirmPreviousFocus = null;
        this._confirmKeyHandler = null;
        this._confirmBound = false;
        this._onReady = this._onReady.bind(this);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this._onReady);
        } else {
            this._onReady();
        }
    }

    NotificationSystem.prototype._onReady = function () {
        this._bindToastDom();
        this._bindConfirmDom();
    };

    NotificationSystem.prototype._bindToastDom = function () {
        this.container = document.getElementById('geotrakToastStack');
        this.template = document.getElementById('geotrakToastTemplate');
    };

    NotificationSystem.prototype._bindConfirmDom = function () {
        this._confirmDialog = document.getElementById('geotrakConfirmDialog');
        if (!this._confirmDialog) {
            return;
        }
        this._confirmTitle = document.getElementById('geotrakConfirmTitle');
        this._confirmMessage = document.getElementById('geotrakConfirmMessage');
        this._confirmOkBtn = this._confirmDialog.querySelector('[data-geotrak-confirm-ok]');
        this._confirmCancelBtn = this._confirmDialog.querySelector('[data-geotrak-confirm-cancel]');
        this._confirmBackdrop = this._confirmDialog.querySelector('[data-geotrak-confirm-dismiss]');
        if (this._confirmBound) {
            return;
        }
        this._confirmBound = true;
        var self = this;
        if (this._confirmOkBtn) {
            this._confirmOkBtn.addEventListener('click', function () {
                self._finishConfirm(true);
            });
        }
        if (this._confirmCancelBtn) {
            this._confirmCancelBtn.addEventListener('click', function () {
                self._finishConfirm(false);
            });
        }
        if (this._confirmBackdrop) {
            this._confirmBackdrop.addEventListener('click', function () {
                self._finishConfirm(false);
            });
        }
    };

    NotificationSystem.prototype._ensureDom = function () {
        if (!this.container || !this.template) {
            this._bindToastDom();
        }
        return !!(this.container && this.template);
    };

    NotificationSystem.prototype._ensureConfirmDom = function () {
        if (!this._confirmDialog) {
            this._bindConfirmDom();
        }
        return !!(
            this._confirmDialog &&
            this._confirmTitle &&
            this._confirmMessage &&
            this._confirmOkBtn &&
            this._confirmCancelBtn
        );
    };

    NotificationSystem.prototype.confirm = function (options) {
        var opts =
            typeof options === 'string'
                ? { message: options }
                : options && typeof options === 'object'
                  ? options
                  : {};
        var message = opts.message != null ? String(opts.message) : '';
        var t = function (key, fallback) {
            return typeof window.uiT === 'function'
                ? window.uiT(key, fallback)
                : fallback;
        };
        var title =
            opts.title != null ? String(opts.title) : t('confirm', 'Confirm');
        var confirmLabel =
            opts.confirmLabel != null
                ? String(opts.confirmLabel)
                : t('confirm', 'Confirm');
        var cancelLabel =
            opts.cancelLabel != null
                ? String(opts.cancelLabel)
                : t('cancel', 'Cancel');
        var isDanger = opts.variant === 'danger';

        if (!this._ensureConfirmDom()) {
            return Promise.resolve(false);
        }

        if (this._confirmResolve) {
            this._finishConfirm(false);
        }

        var self = this;
        return new Promise(function (resolve) {
            self._confirmResolve = resolve;
            self._confirmPreviousFocus = document.activeElement;

            if (isDanger) {
                self._confirmDialog.setAttribute('data-variant', 'danger');
            } else {
                self._confirmDialog.removeAttribute('data-variant');
            }
            self._confirmTitle.textContent = title;
            self._confirmMessage.textContent = message;
            self._confirmOkBtn.textContent = confirmLabel;
            self._confirmCancelBtn.textContent = cancelLabel;

            self._confirmDialog.hidden = false;
            self._confirmDialog.setAttribute('aria-hidden', 'false');
            document.body.classList.add('geotrak-confirm-open');

            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    self._confirmDialog.classList.add('is-open');
                    self._confirmOkBtn.focus();
                });
            });

            self._confirmKeyHandler = function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    self._finishConfirm(false);
                }
            };
            document.addEventListener('keydown', self._confirmKeyHandler);
        });
    };

    NotificationSystem.prototype._finishConfirm = function (confirmed) {
        var resolve = this._confirmResolve;
        this._confirmResolve = null;

        if (this._confirmKeyHandler) {
            document.removeEventListener('keydown', this._confirmKeyHandler);
            this._confirmKeyHandler = null;
        }

        if (!this._confirmDialog) {
            if (typeof resolve === 'function') {
                resolve(!!confirmed);
            }
            return;
        }

        this._confirmDialog.classList.remove('is-open');
        this._confirmDialog.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('geotrak-confirm-open');

        var previousFocus = this._confirmPreviousFocus;
        this._confirmPreviousFocus = null;
        var dialog = this._confirmDialog;

        window.setTimeout(function () {
            if (dialog) {
                dialog.hidden = true;
            }
            if (previousFocus && typeof previousFocus.focus === 'function') {
                try {
                    previousFocus.focus();
                } catch (e) {
                    /* ignore */
                }
            }
            if (typeof resolve === 'function') {
                resolve(!!confirmed);
            }
        }, 260);
    };

    NotificationSystem.prototype.tryShow = function (message, type, duration, options) {
        var opts = options && typeof options === 'object' ? options : {};
        var maxAttempts = typeof opts.maxAttempts === 'number' ? opts.maxAttempts : 20;
        var onUnavailable = opts.onUnavailable;
        var dur = typeof duration === 'number' ? duration : this.autoHideDelay;
        var self = this;
        var attempt = function (n) {
            if (self._ensureDom()) {
                return self.show(message, type, dur);
            }
            if (n > 0) {
                setTimeout(function () {
                    attempt(n - 1);
                }, 50);
                return null;
            }
            if (typeof onUnavailable === 'function') {
                onUnavailable(message);
            }
            return null;
        };
        return attempt(maxAttempts);
    };

    NotificationSystem.prototype.showMany = function (items, duration, staggerMs) {
        if (!items || !items.length) {
            return;
        }
        var d = typeof duration === 'number' ? duration : this.autoHideDelay;
        var gap = typeof staggerMs === 'number' ? staggerMs : 140;
        items.forEach(function (item, index) {
            var oneDuration = typeof item.duration === 'number' ? item.duration : d;
            setTimeout(function () {
                window.notify.tryShow(item.message, item.type, oneDuration);
            }, index * gap);
        });
    };

    NotificationSystem.prototype.show = function (message, type, duration) {
        if (!this._ensureDom()) {
            return null;
        }

        var normalized = normalizeType(type);
        var ms = typeof duration === 'number' ? duration : this.autoHideDelay;
        var safeText = safeUserMessage(message, defaultSafeFallback());
        var id =
            'geotrak-toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
        var el = this._createToast(id, safeText, normalized, ms);

        this.container.appendChild(el);

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                el.classList.add('show');
            });
        });

        if (ms > 0) {
            el._geotrakAutoHide = window.setTimeout(function () {
                window.notify.hide(id);
            }, ms);
        }

        return id;
    };

    NotificationSystem.prototype._createToast = function (id, message, type, durationMs) {
        var clone = this.template.content.cloneNode(true);
        var toast = clone.querySelector('.geotrak-toast');
        var titleEl = clone.querySelector('.geotrak-toast__title');
        var messageEl = clone.querySelector('.geotrak-toast__message');
        var iconEl = clone.querySelector('.geotrak-toast__icon-wrap');
        var closeBtn = clone.querySelector('.geotrak-toast__close');
        var progressTrack = clone.querySelector('.geotrak-toast__progress-track');
        var progressBar = clone.querySelector('.geotrak-toast__progress-bar');

        toast.id = id;
        toast.setAttribute('data-type', type);
        titleEl.textContent = typeLabel(type);
        messageEl.textContent = message == null ? '' : String(message);

        if (type === 'error') {
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'assertive');
        }

        iconEl.innerHTML = ICONS[type] || ICONS.info;

        if (closeBtn) {
            closeBtn.setAttribute('aria-label', dismissLabel());
        }

        if (durationMs > 0 && progressTrack && progressBar) {
            progressTrack.hidden = false;
            toast.style.setProperty('--toast-duration-ms', durationMs + 'ms');
        }

        var self = this;
        closeBtn.addEventListener('click', function () {
            self.hide(id);
        });

        return toast;
    };

    NotificationSystem.prototype.hide = function (notificationId) {
        var notification = document.getElementById(notificationId);
        if (!notification) {
            return;
        }
        if (notification._geotrakAutoHide) {
            window.clearTimeout(notification._geotrakAutoHide);
            notification._geotrakAutoHide = null;
        }
        var bar = notification.querySelector('.geotrak-toast__progress-bar');
        if (bar) {
            bar.style.animation = 'none';
            bar.style.transform = 'scaleX(0)';
        }
        notification.classList.add('hide');
        window.setTimeout(function () {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 320);
    };

    NotificationSystem.prototype.success = function (message, duration) {
        return this.show(message, 'success', duration);
    };

    NotificationSystem.prototype.error = function (message, duration) {
        return this.show(message, 'error', duration);
    };

    NotificationSystem.prototype.warning = function (message, duration) {
        return this.show(message, 'warning', duration);
    };

    NotificationSystem.prototype.info = function (message, duration) {
        return this.show(message, 'info', duration);
    };

    window.notify = new NotificationSystem();
})();
