/**
 * First-login personal password setup: show/hide + match hint.
 */
(function () {
    'use strict';

    function t(key, fallback) {
        if (typeof window.uiT === 'function') {
            return window.uiT(key, fallback);
        }
        return fallback != null ? fallback : key;
    }

    document.addEventListener('DOMContentLoaded', function () {
        const toggles = document.querySelectorAll('[data-toggle-password]');
        const newPassword = document.getElementById('new_password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');

        function setRevealLabel(button, revealing) {
            if (!button) {
                return;
            }
            const label = revealing ? t('hide_password', 'Hide') : t('show_password', 'Show');
            button.textContent = label;
            button.setAttribute('aria-label', label);
        }

        function toggleVisibility(inputId, button) {
            const input = document.getElementById(inputId);
            if (!input) {
                return;
            }
            const revealing = input.type === 'password';
            input.type = revealing ? 'text' : 'password';
            setRevealLabel(button, revealing);
        }

        toggles.forEach(function (btn) {
            const targetId = btn.getAttribute('data-toggle-password');
            btn.addEventListener('click', function () {
                toggleVisibility(targetId, btn);
            });
        });

        function updateMatchHint() {
            if (!newPassword || !confirmPassword || !matchHint) {
                return;
            }

            matchHint.classList.remove(
                'auth-field__hint--ok',
                'auth-field__hint--bad'
            );

            if (!confirmPassword.value && !newPassword.value) {
                matchHint.textContent = t(
                    'confirm_password_hint',
                    'Re-enter the password to confirm'
                );
                return;
            }

            if (
                confirmPassword.value === newPassword.value &&
                newPassword.value.length >= 8
            ) {
                matchHint.textContent = t('passwords_match', 'Passwords match');
                matchHint.classList.add('auth-field__hint--ok');
                return;
            }

            if (
                confirmPassword.value &&
                confirmPassword.value !== newPassword.value
            ) {
                matchHint.textContent = t(
                    'passwords_mismatch',
                    'Passwords do not match'
                );
                matchHint.classList.add('auth-field__hint--bad');
                return;
            }

            matchHint.textContent = t(
                'confirm_password_hint',
                'Re-enter the password to confirm'
            );
        }

        if (newPassword) {
            newPassword.addEventListener('input', updateMatchHint);
        }
        if (confirmPassword) {
            confirmPassword.addEventListener('input', updateMatchHint);
        }
    });
})();
