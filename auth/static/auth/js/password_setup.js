(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const toggles = document.querySelectorAll('[data-toggle-password]');
        const newPassword = document.getElementById('new_password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');
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
                matchHint.textContent = 'Re-enter the password to confirm.';
                matchHint.classList.remove('text-green-600', 'text-red-600');
                matchHint.classList.add('text-gray-500');
                return;
            }

            if (confirmPassword.value === newPassword.value && newPassword.value.length >= 8) {
                matchHint.textContent = 'Passwords match.';
                matchHint.classList.remove('text-gray-500', 'text-red-600');
                matchHint.classList.add('text-green-600');
            } else if (confirmPassword.value && confirmPassword.value !== newPassword.value) {
                matchHint.textContent = 'Passwords do not match.';
                matchHint.classList.remove('text-gray-500', 'text-green-600');
                matchHint.classList.add('text-red-600');
            } else {
                matchHint.textContent = 'Re-enter the password to confirm.';
                matchHint.classList.remove('text-green-600', 'text-red-600');
                matchHint.classList.add('text-gray-500');
            }
        };

        if (newPassword) newPassword.addEventListener('input', updateMatchHint);
        if (confirmPassword) confirmPassword.addEventListener('input', updateMatchHint);

    });
})();

