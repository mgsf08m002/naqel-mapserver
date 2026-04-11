(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const toggles = document.querySelectorAll('[data-toggle-password]');
        const newPassword = document.getElementById('new_password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');
        const notifyNode = document.getElementById('securityNotify');

        const sessionsSection = document.getElementById('sessionsSection');
        const sessionsContainer = document.getElementById('sessionsContainer');
        const sessionsSkeleton = document.getElementById('sessionsSkeleton');
        const sessionsEmptyState = document.getElementById('sessionsEmptyState');
        const refreshSessionsButton = document.getElementById('refreshSessionsButton');

        const toggleVisibility = (inputId, button) => {
            const input = document.getElementById(inputId);
            if (!input) return;

            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            if (button) {
                button.textContent = isHidden ? 'Hide' : 'Show';
            }
        };

        toggles.forEach((btn) => {
            const targetId = btn.getAttribute('data-toggle-password');
            btn.addEventListener('click', () => toggleVisibility(targetId, btn));
        });

        const updateMatchHint = () => {
            if (!newPassword || !confirmPassword || !matchHint) return;
            if (!confirmPassword.value && !newPassword.value) {
                matchHint.textContent = 'Re-enter the new password to confirm.';
                matchHint.classList.remove('text-green-600', 'text-red-600');
                matchHint.classList.add('text-gray-500');
                return;
            }

            if (confirmPassword.value === newPassword.value) {
                matchHint.textContent = 'Passwords match.';
                matchHint.classList.remove('text-gray-500', 'text-red-600');
                matchHint.classList.add('text-green-600');
            } else {
                matchHint.textContent = 'Passwords do not match.';
                matchHint.classList.remove('text-gray-500', 'text-green-600');
                matchHint.classList.add('text-red-600');
            }
        };

        if (newPassword) newPassword.addEventListener('input', updateMatchHint);
        if (confirmPassword) confirmPassword.addEventListener('input', updateMatchHint);

        // Password change notifications
        if (notifyNode) {
            const changed = notifyNode.getAttribute('data-password-changed') === 'true';
            const errorsRaw = notifyNode.getAttribute('data-errors');
            if (changed) {
                window.notify.tryShow('Password updated successfully. Please sign in again.', 'success');
            }
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) window.notify.tryShow(trimmed, 'error');
                });
            }
        }

        // Sessions management
        if (!sessionsSection || !sessionsContainer || !sessionsSkeleton || !sessionsEmptyState) {
            return;
        }

        const sessionsEndpoint = sessionsSection.getAttribute('data-sessions-endpoint') || '/security/api/sessions/';
        const terminateEndpoint = sessionsSection.getAttribute('data-terminate-endpoint') || '/security/api/sessions/terminate/';
        const browserIconBase = sessionsSection.getAttribute('data-browser-icon-base') || '';

        function formatDateLabel(isoString) {
            if (!isoString) return 'Unknown time';
            const date = new Date(isoString);
            if (Number.isNaN(date.getTime())) return 'Unknown time';
            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function getCsrfToken() {
            const input = document.querySelector('[name=csrfmiddlewaretoken]');
            return input ? input.value : '';
        }

        function renderSessions(sessions) {
            sessionsContainer.innerHTML = '';
            sessionsEmptyState.classList.add('hidden');

            if (!sessions || sessions.length === 0) {
                sessionsEmptyState.classList.remove('hidden');
                return;
            }

            let nonCurrentCount = 0;

            sessions.forEach((session) => {
                const isCurrent = !!session.is_current;
                if (!isCurrent) nonCurrentCount += 1;

                const wrapper = document.createElement('div');
                wrapper.className = [
                    'flex items-center justify-between rounded-2xl border px-4 py-3 transition-colors',
                    isCurrent ? 'border-black bg-white' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                ].join(' ');

                const left = document.createElement('div');
                left.className = 'flex items-center gap-3';

                const iconWrapper = document.createElement('div');
                iconWrapper.className = 'flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white';

                const img = document.createElement('img');
                img.alt = (session.browser || 'Browser') + ' icon';
                img.className = 'h-5 w-5 object-contain';

                const browserKey = (session.browser || 'other').toLowerCase();
                img.src = browserIconBase + browserKey + '.png';

                iconWrapper.appendChild(img);

                const textWrapper = document.createElement('div');
                textWrapper.className = 'space-y-0.5';

                const title = document.createElement('p');
                title.className = 'text-sm font-semibold text-gray-900 flex items-center gap-2';
                title.textContent = session.browser ? session.browser.charAt(0).toUpperCase() + session.browser.slice(1) : 'Unknown browser';

                if (isCurrent) {
                    const badge = document.createElement('span');
                    badge.className = 'inline-flex items-center rounded-full bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white';
                    badge.textContent = 'This browser';
                    title.appendChild(badge);
                }

                const meta = document.createElement('p');
                meta.className = 'text-xs text-gray-500';

                const parts = [];
                if (session.ip_address) {
                    parts.push(`IP ${session.ip_address}`);
                }
                if (session.last_seen_at) {
                    parts.push(`Last active ${formatDateLabel(session.last_seen_at)}`);
                } else if (session.created_at) {
                    parts.push(`Signed in ${formatDateLabel(session.created_at)}`);
                }
                meta.textContent = parts.join(' · ') || 'No additional details available.';

                textWrapper.appendChild(title);
                textWrapper.appendChild(meta);

                left.appendChild(iconWrapper);
                left.appendChild(textWrapper);

                const right = document.createElement('div');

                if (isCurrent) {
                    const label = document.createElement('span');
                    label.className = 'rounded-full border border-gray-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 bg-white';
                    label.textContent = 'Active now';
                    right.appendChild(label);
                } else {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'inline-flex items-center justify-center rounded-full border border-gray-900 bg-black px-4 py-1.5 text-xs font-semibold text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200';
                    button.textContent = 'Log out';
                    button.addEventListener('click', () => {
                        terminateSession(session.session_key, wrapper);
                    });
                    right.appendChild(button);
                }

                wrapper.appendChild(left);
                wrapper.appendChild(right);
                sessionsContainer.appendChild(wrapper);
            });

            if (nonCurrentCount === 0) {
                sessionsEmptyState.classList.remove('hidden');
            }
        }

        async function loadSessions(showToastOnError = true) {
            if (sessionsSkeleton) {
                sessionsSkeleton.classList.remove('hidden');
            }

            try {
                const response = await fetch(sessionsEndpoint, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    if (showToastOnError) {
                        const msg = data && data.message ? data.message : 'Unable to load sessions.';
                        window.notify.tryShow(msg, 'error');
                    }
                    return;
                }

                renderSessions(data.sessions || []);
            } catch (error) {
                if (showToastOnError) {
                    window.notify.tryShow('Unable to load sessions. Please try again.', 'error');
                }
            } finally {
                if (sessionsSkeleton) {
                    sessionsSkeleton.classList.add('hidden');
                }
            }
        }

        async function terminateSession(sessionKey, rowElement) {
            const csrfToken = getCsrfToken();
            if (!csrfToken) {
                window.notify.tryShow('CSRF token not found. Please refresh the page.', 'error');
                return;
            }

            if (!sessionKey) return;

            if (rowElement) {
                rowElement.classList.add('opacity-60');
            }

            try {
                const response = await fetch(terminateEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ session_key: sessionKey })
                });

                const data = await response.json();

                if (response.ok && data.success && data.session_terminated) {
                    window.notify.tryShow('Session has been logged out successfully.', 'success');
                    await loadSessions(false);

                    if (data.current_session_terminated) {
                        setTimeout(() => {
                            window.location.href = '/login/';
                        }, 800);
                    }
                } else {
                    const msg = data && data.message ? data.message : 'Unable to terminate session.';
                    window.notify.tryShow(msg, 'error');
                }
            } catch (error) {
                window.notify.tryShow('Unable to terminate session. Please try again.', 'error');
            } finally {
                if (rowElement) {
                    rowElement.classList.remove('opacity-60');
                }
            }
        }

        if (refreshSessionsButton) {
            refreshSessionsButton.addEventListener('click', () => {
                loadSessions(true);
            });
        }

        loadSessions(false);
    });
})();
