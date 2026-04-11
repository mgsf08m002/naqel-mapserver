/**
 * Toast notifications — shared UI for Django messages and client-side calls.
 */
(function () {
    'use strict';

    const TYPE_LABELS = {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Information',
    };

    const ICONS = {
        success:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
        error:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
        warning:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
        info:
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
    };

    function normalizeType(type) {
        const t = String(type || 'info').toLowerCase();
        if (t === 'danger' || t === 'failure') {
            return 'error';
        }
        if (TYPE_LABELS[t]) {
            return t;
        }
        return 'info';
    }

    class NotificationSystem {
        constructor() {
            this.container = null;
            this.template = null;
            this.autoHideDelay = 7000;
            this._domBound = false;
            this._bindDom = this._bindDom.bind(this);
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', this._bindDom);
            } else {
                this._bindDom();
            }
        }

        _bindDom() {
            if (this._domBound) {
                return;
            }
            this.container = document.getElementById('notificationContainer');
            this.template = document.getElementById('notificationTemplate');
            this._domBound = true;
        }

        _ensureDom() {
            if (!this.container || !this.template) {
                this._bindDom();
            }
            return !!(this.container && this.template);
        }

        /**
         * Wait for the toast mount point, then show. Callers use this instead of local retry loops.
         * @param {object} [options]
         * @param {number} [options.maxAttempts]
         * @param {function(string): void} [options.onUnavailable] — if the stack never appears
         */
        tryShow(message, type, duration, options) {
            const opts = options && typeof options === 'object' ? options : {};
            const maxAttempts = typeof opts.maxAttempts === 'number' ? opts.maxAttempts : 20;
            const onUnavailable = opts.onUnavailable;
            const dur = typeof duration === 'number' ? duration : this.autoHideDelay;
            const normalized = normalizeType(type);
            const self = this;
            const attempt = function (n) {
                if (self._ensureDom()) {
                    return self.show(message, normalized, dur);
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
        }

        /**
         * @param {{ message: string, type?: string }[]} items
         * @param {number} duration - default ms per toast (0 = no auto-hide)
         * @param {number} staggerMs - delay between stacked toasts
         */
        showMany(items, duration, staggerMs) {
            if (!items || !items.length) {
                return;
            }
            const d = typeof duration === 'number' ? duration : this.autoHideDelay;
            const gap = typeof staggerMs === 'number' ? staggerMs : 140;
            items.forEach(function (item, index) {
                const oneDuration = typeof item.duration === 'number' ? item.duration : d;
                setTimeout(function () {
                    window.notify.tryShow(item.message, item.type, oneDuration);
                }, index * gap);
            });
        }

        show(message, type, duration) {
            if (!this._ensureDom()) {
                return null;
            }

            const normalized = normalizeType(type);
            const ms = typeof duration === 'number' ? duration : this.autoHideDelay;
            const id =
                'notification-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
            const el = this._createToast(id, message, normalized, ms);

            this.container.appendChild(el);

            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    el.classList.add('show');
                });
            });

            if (ms > 0) {
                el._naqelAutoHide = window.setTimeout(function () {
                    window.notify.hide(id);
                }, ms);
            }

            return id;
        }

        _createToast(id, message, type, durationMs) {
            const clone = this.template.content.cloneNode(true);
            const toast = clone.querySelector('.naqel-toast');
            const labelEl = clone.querySelector('.notification-label');
            const messageEl = clone.querySelector('.notification-message');
            const iconEl = clone.querySelector('.notification-icon');
            const closeBtn = clone.querySelector('.notification-close');
            const progressTrack = clone.querySelector('.notification-progress-track');
            const progressBar = clone.querySelector('.notification-progress-bar');

            toast.id = id;
            toast.setAttribute('data-type', type);
            labelEl.textContent = TYPE_LABELS[type] || TYPE_LABELS.info;
            messageEl.textContent = this.decodeHtmlEntities(message);

            if (type === 'error') {
                toast.setAttribute('role', 'alert');
                toast.setAttribute('aria-live', 'assertive');
            } else {
                toast.setAttribute('role', 'status');
                toast.setAttribute('aria-live', 'polite');
            }

            iconEl.innerHTML = ICONS[type] || ICONS.info;

            if (durationMs > 0 && progressTrack && progressBar) {
                progressTrack.hidden = false;
                toast.style.setProperty('--toast-duration-ms', durationMs + 'ms');
            }

            const self = this;
            closeBtn.addEventListener('click', function () {
                self.hide(id);
            });

            return toast;
        }

        decodeHtmlEntities(text) {
            if (!text) {
                return '';
            }
            let decoded = String(text);
            decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, function (_m, code) {
                return String.fromCharCode(parseInt(code, 16));
            });
            decoded = decoded
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&#x27;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
            const textarea = document.createElement('textarea');
            textarea.innerHTML = decoded;
            return textarea.value;
        }

        hide(notificationId) {
            const notification = document.getElementById(notificationId);
            if (!notification) {
                return;
            }
            if (notification._naqelAutoHide) {
                window.clearTimeout(notification._naqelAutoHide);
                notification._naqelAutoHide = null;
            }
            const bar = notification.querySelector('.notification-progress-bar');
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
        }

        hideAll() {
            if (!this.container) {
                return;
            }
            var ids = [];
            this.container.querySelectorAll('.naqel-toast').forEach(function (node) {
                if (node.id) {
                    ids.push(node.id);
                }
            });
            var self = this;
            ids.forEach(function (id) {
                self.hide(id);
            });
        }

        success(message, duration) {
            return this.show(message, 'success', duration);
        }

        error(message, duration) {
            return this.show(message, 'error', duration);
        }

        warning(message, duration) {
            return this.show(message, 'warning', duration);
        }

        info(message, duration) {
            return this.show(message, 'info', duration);
        }
    }

    window.notify = new NotificationSystem();
})();
