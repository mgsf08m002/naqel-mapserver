(function() {
    'use strict';

    function t(key, fallback) {
        return typeof window.uiT === 'function' ? window.uiT(key, fallback) : fallback;
    }

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
                    label.textContent = showPlain
                        ? t('hide_password', 'Hide')
                        : t('show_password', 'Show');
                }
            });
        });

        const updateMatchHint = () => {
            if (!password || !confirmPassword || !matchHint) {
                return;
            }
            if (!confirmPassword.value && !password.value) {
                matchHint.textContent = t('confirm_password_hint', 'Re-enter the password to confirm');
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

        function updatePermissionsUI(role) {
            const isManager = role === 'manager';
            if (permissionsTitle) {
                permissionsTitle.textContent = isManager
                    ? t('add_user_manager_perms_title', 'Manager Permissions')
                    : t('add_user_editor_perms_title', 'Editor Permissions');
            }
            if (permissionsDescription) {
                permissionsDescription.textContent = isManager
                    ? t('add_user_manager_perms_desc', 'Select the permissions you want to grant to this manager.')
                    : t('add_user_editor_perms_desc', 'Select the permissions you want to grant to this editor.');
            }
            dashboardPermissionLabel?.classList.toggle('is-hidden', !isManager);
            if (securityDescription) {
                securityDescription.textContent = isManager
                    ? t('add_user_security_desc_manager', 'Allow the manager to access the security settings page')
                    : t('add_user_security_desc_editor', 'Allow the editor to access the security settings page');
            }
            if (accountInfoDescription) {
                accountInfoDescription.textContent = isManager
                    ? t('add_user_account_desc_manager', 'Allow the manager to access and update account information')
                    : t('add_user_account_desc_editor', 'Allow the editor to access and update account information');
            }
            if (createUserBtn) {
                createUserBtn.textContent = isManager
                    ? t('add_user_create_manager', 'Create Manager')
                    : t('add_user_create_editor', 'Create Editor');
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
