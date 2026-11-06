(function () {
    'use strict';

    function t(key, fallback) {
        return typeof window.uiT === 'function' ? window.uiT(key, fallback) : fallback;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-toggle-password]').forEach((button) => {
            button.addEventListener('click', () => {
                const input = document.getElementById(button.getAttribute('data-toggle-password'));
                if (!input) {
                    return;
                }
                const showPlain = input.type === 'password';
                input.type = showPlain ? 'text' : 'password';
                const label = button.querySelector('span');
                if (label) {
                    label.textContent = showPlain
                        ? t('hide_password', 'Hide')
                        : t('show_password', 'Show');
                }
            });
        });

        const password = document.getElementById('new_password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');

        const updateMatchHint = () => {
            if (!password || !confirmPassword || !matchHint) {
                return;
            }
            if (!confirmPassword.value && !password.value) {
                matchHint.textContent = t(
                    'confirm_password_hint',
                    'Re-enter the password to confirm'
                );
                matchHint.classList.remove('is-ok', 'is-error');
                return;
            }
            const matches = confirmPassword.value === password.value;
            matchHint.textContent = matches
                ? t('passwords_match', 'Passwords match')
                : t('passwords_mismatch', 'Passwords do not match');
            matchHint.classList.toggle('is-ok', matches);
            matchHint.classList.toggle('is-error', !matches);
        };

        password?.addEventListener('input', updateMatchHint);
        confirmPassword?.addEventListener('input', updateMatchHint);

        document.querySelectorAll('[data-copy-password]').forEach((button) => {
            button.addEventListener('click', async () => {
                const target = document.querySelector(button.getAttribute('data-copy-password'));
                if (!target) {
                    return;
                }
                const text = target.textContent.trim();
                try {
                    await navigator.clipboard.writeText(text);
                    if (window.notify) {
                        window.notify.success(t('toast_copied', 'Copied'));
                    }
                } catch {
                    if (window.notify) {
                        window.notify.error(t('toast_couldnt_copy', "Couldn't copy"));
                    }
                }
            });
        });

        document.querySelectorAll('[data-dismiss-confirm]').forEach((button) => {
            button.addEventListener('click', (event) => {
                const message = button.getAttribute('data-dismiss-confirm');
                if (message && !window.confirm(message)) {
                    event.preventDefault();
                }
            });
        });

        document.querySelectorAll('.passwords-toggle-reset').forEach((button) => {
            button.addEventListener('click', () => {
                const panel = document.getElementById(button.getAttribute('data-target'));
                if (!panel) {
                    return;
                }
                const willShow = panel.classList.contains('is-hidden');
                document.querySelectorAll('.passwords-reset-panel').forEach((el) => {
                    el.classList.add('is-hidden');
                });
                if (willShow) {
                    panel.classList.remove('is-hidden');
                }
            });
        });
    });
})();
