(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.querySelector('.users-form-card form');
        const password = document.getElementById('password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');
        const userDetailsForm = document.getElementById('userDetailsForm');
        const permissionsForm = document.getElementById('permissionsForm');
        const nextToPermissionsBtn = document.getElementById('nextToPermissionsBtn');
        const backToUserDetailsBtn = document.getElementById('backToUserDetailsBtn');
        const roleSelect = document.getElementById('role');
        const permissionsTitle = document.getElementById('permissionsTitle');
        const permissionsDescription = document.getElementById('permissionsDescription');
        const dashboardPermissionLabel = document.getElementById('dashboardPermissionLabel');
        const securityDescription = document.getElementById('securityDescription');
        const accountInfoDescription = document.getElementById('accountInfoDescription');
        const createUserBtn = document.getElementById('createUserBtn');

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
                    label.textContent = showPlain ? 'Hide' : 'Show';
                }
            });
        });

        const updateMatchHint = () => {
            if (!password || !confirmPassword || !matchHint) {
                return;
            }
            if (!confirmPassword.value && !password.value) {
                matchHint.textContent = 'Re-enter the password to confirm';
                matchHint.classList.remove('is-ok', 'is-error');
                return;
            }
            const matches = confirmPassword.value === password.value;
            matchHint.textContent = matches ? 'Passwords match' : 'Passwords do not match';
            matchHint.classList.toggle('is-ok', matches);
            matchHint.classList.toggle('is-error', !matches);
        };

        password?.addEventListener('input', updateMatchHint);
        confirmPassword?.addEventListener('input', updateMatchHint);

        function updatePermissionsUI(role) {
            const isManager = role === 'manager';
            if (permissionsTitle) {
                permissionsTitle.textContent = isManager ? 'Manager Permissions' : 'Editor Permissions';
            }
            if (permissionsDescription) {
                permissionsDescription.textContent = isManager
                    ? 'Select the permissions you want to grant to this manager.'
                    : 'Select the permissions you want to grant to this editor.';
            }
            dashboardPermissionLabel?.classList.toggle('is-hidden', !isManager);
            if (securityDescription) {
                securityDescription.textContent = isManager
                    ? 'Allow the manager to access the security settings page'
                    : 'Allow the editor to access the security settings page';
            }
            if (accountInfoDescription) {
                accountInfoDescription.textContent = isManager
                    ? 'Allow the manager to access and update account information'
                    : 'Allow the editor to access and update account information';
            }
            if (createUserBtn) {
                createUserBtn.textContent = isManager ? 'Create Manager' : 'Create Editor';
            }
        }

        nextToPermissionsBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            if (!form?.checkValidity()) {
                form?.reportValidity();
                return;
            }
            const role = roleSelect?.value || '';
            if (role !== 'manager' && role !== 'editor') {
                form.submit();
                return;
            }
            updatePermissionsUI(role);
            userDetailsForm?.classList.add('is-hidden');
            permissionsForm?.classList.remove('is-hidden');
        });

        backToUserDetailsBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            permissionsForm?.classList.add('is-hidden');
            userDetailsForm?.classList.remove('is-hidden');
        });
    });
})();
