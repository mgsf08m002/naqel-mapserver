(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const toggles = document.querySelectorAll('[data-toggle-password]');
        const newPassword = document.getElementById('new_password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');
        const notifyNode = document.getElementById('securityNotify');

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

        // Helper function to show notification with retry logic
        function showNotification(message, type = 'info') {
            function tryShowNotification(retries = 10) {
                if (window.notify && window.notify.show) {
                    if (type === 'success') {
                        window.notify.success(message);
                    } else if (type === 'error') {
                        window.notify.error(message);
                    } else if (type === 'warning') {
                        window.notify.warning(message);
                    } else {
                        window.notify.info(message);
                    }
                } else if (retries > 0) {
                    setTimeout(() => tryShowNotification(retries - 1), 50);
                }
            }
            tryShowNotification();
        }

        // Fire centralized notifications if available
        if (notifyNode) {
            const changed = notifyNode.getAttribute('data-password-changed') === 'true';
            const errorsRaw = notifyNode.getAttribute('data-errors');
            if (changed) {
                showNotification('Password updated successfully. Please sign in again.', 'success');
            }
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) showNotification(trimmed, 'error');
                });
            }
        }
    });
})();

