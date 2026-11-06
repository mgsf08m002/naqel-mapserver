(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('.security-page');
        if (!page) return;

        const sessionsSection = document.getElementById('sessionsSection');
        const sessionsContainer = document.getElementById('sessionsContainer');
        const sessionsSkeleton = document.getElementById('sessionsSkeleton');
        const sessionsEmptyState = document.getElementById('sessionsEmptyState');
        const refreshSessionsButton = document.getElementById('refreshSessionsButton');
        const terminateOthersButton = document.getElementById('terminateOtherSessionsButton');
        const sessionCountEl = document.getElementById('securitySessionCount');
        const newPassword = document.getElementById('new_password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');
        const toggles = page.querySelectorAll('[data-toggle-password]');

        const i18n = {
            show: page.dataset.i18nShow || 'Show',
            hide: page.dataset.i18nHide || 'Hide',
            hint: page.dataset.i18nHint || 'Re-enter the password to confirm',
            match: page.dataset.i18nMatch || 'Passwords match',
            mismatch: page.dataset.i18nMismatch || 'Passwords do not match',
            thisBrowser: page.dataset.i18nThisBrowser || 'This browser',
            activeNow: page.dataset.i18nActiveNow || 'Active now',
            logOut: page.dataset.i18nLogOut || 'Log out',
            unknownBrowser: page.dataset.i18nUnknownBrowser || 'Unknown browser',
            unknownTime: page.dataset.i18nUnknownTime || 'Unknown time',
            labelSystem: page.dataset.i18nLabelSystem || 'System',
            labelLocation: page.dataset.i18nLabelLocation || 'Location',
            labelIp: page.dataset.i18nLabelIp || 'IP Address',
            lastActive: page.dataset.i18nLastActive || 'Last Active',
            signedIn: page.dataset.i18nSignedIn || 'Signed In',
            noDetails: page.dataset.i18nNoDetails || 'No additional details available.',
            sessionsOne: page.dataset.i18nSessionsOne || '1 session',
            sessionsTwo: page.dataset.i18nSessionsTwo || '2 sessions',
            sessionsFew: page.dataset.i18nSessionsFew || '{count} sessions',
            sessionsMany: page.dataset.i18nSessionsMany || '{count} sessions',
        };

        function t(key, fallback) {
            return typeof window.uiT === 'function' ? window.uiT(key, fallback) : fallback;
        }

        function setHidden(el, hidden) {
            if (!el) return;
            el.classList.toggle('is-hidden', !!hidden);
        }

        function updateSessionCount(count) {
            if (!sessionCountEl) return;
            const n = Number(count) || 0;
            if (n === 1) {
                sessionCountEl.textContent = i18n.sessionsOne;
                return;
            }
            if (n === 2) {
                sessionCountEl.textContent = i18n.sessionsTwo.replace('{count}', '2');
                return;
            }
            if (n >= 3 && n <= 10) {
                sessionCountEl.textContent = i18n.sessionsFew.replace('{count}', String(n));
                return;
            }
            sessionCountEl.textContent = i18n.sessionsMany.replace('{count}', String(n));
        }

        toggles.forEach((btn) => {
            const targetId = btn.getAttribute('data-toggle-password');
            btn.addEventListener('click', () => {
                const input = document.getElementById(targetId);
                if (!input) return;
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.textContent = show ? i18n.hide : i18n.show;
            });
        });

        const updateMatchHint = () => {
            if (!newPassword || !confirmPassword || !matchHint) return;
            matchHint.classList.remove('is-ok', 'is-bad');
            if (!confirmPassword.value && !newPassword.value) {
                matchHint.textContent = i18n.hint;
                return;
            }
            if (confirmPassword.value === newPassword.value) {
                matchHint.textContent = i18n.match;
                matchHint.classList.add('is-ok');
            } else {
                matchHint.textContent = i18n.mismatch;
                matchHint.classList.add('is-bad');
            }
        };

        if (newPassword) newPassword.addEventListener('input', updateMatchHint);
        if (confirmPassword) confirmPassword.addEventListener('input', updateMatchHint);

        if (!sessionsSection || !sessionsContainer || !sessionsSkeleton || !sessionsEmptyState) {
            return;
        }

        const sessionsEndpoint = sessionsSection.getAttribute('data-sessions-endpoint') || '/security/api/sessions/';
        const terminateEndpoint = sessionsSection.getAttribute('data-terminate-endpoint') || '/security/api/sessions/terminate/';
        const terminateOthersEndpoint =
            sessionsSection.getAttribute('data-terminate-others-endpoint') ||
            '/security/api/sessions/terminate-others/';
        const browserIconBase = sessionsSection.getAttribute('data-browser-icon-base') || '';

        function formatDateLabel(isoString) {
            if (typeof window.formatRiyadhDateTime === 'function') {
                return window.formatRiyadhDateTime(isoString, i18n.unknownTime);
            }
            return i18n.unknownTime;
        }

        function getCsrfToken() {
            const input = document.querySelector('[name=csrfmiddlewaretoken]');
            return input ? input.value : '';
        }

        function browserLabel(session) {
            if (session && session.browser_label) return session.browser_label;
            const browser = session && session.browser;
            if (!browser || browser === 'other') return i18n.unknownBrowser;
            return browser.charAt(0).toUpperCase() + browser.slice(1);
        }

        function makeSvgIcon(pathD, className) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            if (className) svg.setAttribute('class', className);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('stroke-width', '1.7');
            path.setAttribute('d', pathD);
            svg.appendChild(path);
            return svg;
        }

        const ICONS = {
            monitor:
                'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
            pin: 'M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z',
            globe:
                'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
            clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
        };

        function genericBrowserIcon() {
            return makeSvgIcon(ICONS.monitor);
        }

        function appendMetaItem(grid, iconKey, labelText, valueText) {
            if (!valueText) return;
            const item = document.createElement('div');
            item.className = 'security-session__meta-item';
            item.appendChild(makeSvgIcon(ICONS[iconKey] || ICONS.monitor, 'security-session__meta-icon'));
            const label = document.createElement('span');
            label.className = 'security-session__meta-label';
            label.textContent = labelText;
            const value = document.createElement('span');
            value.className = 'security-session__meta-value';
            value.textContent = valueText;
            item.appendChild(label);
            item.appendChild(value);
            grid.appendChild(item);
        }

        function renderSessions(sessions) {
            sessionsContainer.innerHTML = '';
            setHidden(sessionsEmptyState, true);

            const list = Array.isArray(sessions) ? sessions : [];
            updateSessionCount(list.length);

            const otherCount = list.filter((s) => !s.is_current).length;
            setHidden(terminateOthersButton, otherCount === 0);

            if (list.length === 0) {
                setHidden(sessionsEmptyState, false);
                return;
            }

            list.forEach((session) => {
                const isCurrent = !!session.is_current;

                const wrapper = document.createElement('article');
                wrapper.className = 'security-session' + (isCurrent ? ' is-current' : '');

                const top = document.createElement('div');
                top.className = 'security-session__top';

                const identity = document.createElement('div');
                identity.className = 'security-session__identity';

                const iconWrap = document.createElement('div');
                iconWrap.className = 'security-session__icon';
                const browserKey = (session.browser || 'other').toLowerCase();
                const label = browserLabel(session);
                if (session.browser_has_icon && browserKey && browserKey !== 'other') {
                    const img = document.createElement('img');
                    img.src = browserIconBase + browserKey + '.png';
                    img.alt = label;
                    img.onerror = () => {
                        img.remove();
                        iconWrap.appendChild(genericBrowserIcon());
                    };
                    iconWrap.appendChild(img);
                } else {
                    iconWrap.appendChild(genericBrowserIcon());
                }

                const textWrap = document.createElement('div');
                textWrap.className = 'security-session__text';

                const titleRow = document.createElement('div');
                titleRow.className = 'security-session__title-row';

                const title = document.createElement('p');
                title.className = 'security-session__title';
                title.textContent = label;
                titleRow.appendChild(title);

                if (isCurrent) {
                    const badge = document.createElement('span');
                    badge.className = 'security-session__badge';
                    badge.appendChild(makeSvgIcon(ICONS.monitor, 'security-session__badge-icon'));
                    const badgeText = document.createElement('span');
                    badgeText.textContent = i18n.thisBrowser;
                    badge.appendChild(badgeText);
                    titleRow.appendChild(badge);
                }

                textWrap.appendChild(titleRow);

                if (session.device_type_label) {
                    const device = document.createElement('p');
                    device.className = 'security-session__device';
                    device.textContent = session.device_type_label;
                    textWrap.appendChild(device);
                }

                identity.appendChild(iconWrap);
                identity.appendChild(textWrap);

                const right = document.createElement('div');
                right.className = 'security-session__aside';
                if (isCurrent) {
                    const status = document.createElement('span');
                    status.className = 'security-session__status';
                    status.textContent = i18n.activeNow;
                    right.appendChild(status);
                } else {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'security-btn security-btn--danger security-btn--sm';
                    button.textContent = i18n.logOut;
                    button.addEventListener('click', () => terminateSession(session.session_key, wrapper));
                    right.appendChild(button);
                }

                top.appendChild(identity);
                top.appendChild(right);

                const meta = document.createElement('div');
                meta.className = 'security-session__meta';
                appendMetaItem(meta, 'monitor', i18n.labelSystem, session.os_name || '');
                appendMetaItem(meta, 'pin', i18n.labelLocation, session.location_label || '');
                appendMetaItem(meta, 'globe', i18n.labelIp, session.ip_address || '');
                if (isCurrent) {
                    if (session.created_at) {
                        appendMetaItem(meta, 'clock', i18n.signedIn, formatDateLabel(session.created_at));
                    }
                } else if (session.last_seen_at) {
                    appendMetaItem(meta, 'clock', i18n.lastActive, formatDateLabel(session.last_seen_at));
                } else if (session.created_at) {
                    appendMetaItem(meta, 'clock', i18n.signedIn, formatDateLabel(session.created_at));
                }

                wrapper.appendChild(top);
                if (meta.childElementCount > 0) {
                    wrapper.appendChild(meta);
                } else {
                    const empty = document.createElement('p');
                    empty.className = 'security-session__empty';
                    empty.textContent = i18n.noDetails;
                    wrapper.appendChild(empty);
                }
                sessionsContainer.appendChild(wrapper);
            });
        }

        async function loadSessions(showToastOnError) {
            setHidden(sessionsEmptyState, true);
            setHidden(sessionsSkeleton, false);
            try {
                const response = await fetch(sessionsEndpoint, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    if (showToastOnError) {
                        window.notify.tryShow(
                            t('toast_couldnt_load_sessions', "Couldn't load sessions"),
                            'error'
                        );
                    }
                    updateSessionCount(0);
                    setHidden(terminateOthersButton, true);
                    return;
                }
                renderSessions(data.sessions || []);
            } catch (error) {
                if (showToastOnError) {
                    window.notify.tryShow(
                        t('toast_couldnt_load_sessions', "Couldn't load sessions"),
                        'error'
                    );
                }
                updateSessionCount(0);
                setHidden(terminateOthersButton, true);
            } finally {
                setHidden(sessionsSkeleton, true);
            }
        }

        async function terminateSession(sessionKey, rowElement) {
            const csrfToken = getCsrfToken();
            if (!csrfToken) {
                window.notify.tryShow(t('toast_refresh_try_again', 'Refresh and try again'), 'error');
                return;
            }
            if (!sessionKey) return;

            if (rowElement) rowElement.classList.add('is-busy');

            try {
                const response = await fetch(terminateEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken,
                        Accept: 'application/json',
                    },
                    body: JSON.stringify({ session_key: sessionKey }),
                });
                const data = await response.json();

                if (response.ok && data.success && data.session_terminated) {
                    window.notify.tryShow(t('toast_session_ended', 'Session ended'), 'success');
                    await loadSessions(false);
                    if (data.current_session_terminated) {
                        setTimeout(() => {
                            window.location.href = '/login/';
                        }, 800);
                    }
                } else {
                    const fallback = t('toast_refresh_try_again', 'Refresh and try again');
                    window.notify.tryShow(
                        typeof window.safeUserMessage === 'function'
                            ? window.safeUserMessage(data, fallback)
                            : fallback,
                        'error'
                    );
                }
            } catch (error) {
                window.notify.tryShow(t('toast_refresh_try_again', 'Refresh and try again'), 'error');
            } finally {
                if (rowElement) rowElement.classList.remove('is-busy');
            }
        }

        async function terminateOtherSessions() {
            const csrfToken = getCsrfToken();
            if (!csrfToken) {
                window.notify.tryShow(t('toast_refresh_try_again', 'Refresh and try again'), 'error');
                return;
            }

            if (terminateOthersButton) {
                terminateOthersButton.disabled = true;
                terminateOthersButton.classList.add('is-busy');
            }

            try {
                const response = await fetch(terminateOthersEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken,
                        Accept: 'application/json',
                    },
                    body: JSON.stringify({}),
                });
                const data = await response.json();

                if (response.ok && data.success) {
                    const ended = Number(data.sessions_terminated) || 0;
                    window.notify.tryShow(
                        ended > 0
                            ? t('toast_other_sessions_ended', 'Other sessions signed out')
                            : t('toast_no_other_sessions', 'No other active sessions'),
                        ended > 0 ? 'success' : 'info'
                    );
                    await loadSessions(false);
                } else {
                    const fallback = t('toast_refresh_try_again', 'Refresh and try again');
                    window.notify.tryShow(
                        typeof window.safeUserMessage === 'function'
                            ? window.safeUserMessage(data, fallback)
                            : fallback,
                        'error'
                    );
                }
            } catch (error) {
                window.notify.tryShow(t('toast_refresh_try_again', 'Refresh and try again'), 'error');
            } finally {
                if (terminateOthersButton) {
                    terminateOthersButton.disabled = false;
                    terminateOthersButton.classList.remove('is-busy');
                }
            }
        }

        if (refreshSessionsButton) {
            refreshSessionsButton.addEventListener('click', () => loadSessions(true));
        }
        if (terminateOthersButton) {
            terminateOthersButton.addEventListener('click', () => terminateOtherSessions());
        }

        loadSessions(false);
    });
})();
