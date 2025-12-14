(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const toggles = document.querySelectorAll('[data-toggle-password]');
        const password = document.getElementById('password');
        const confirmPassword = document.getElementById('confirm_password');
        const matchHint = document.getElementById('matchHint');
        const notifyNode = document.getElementById('addUserNotify');

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
            if (!password || !confirmPassword || !matchHint) return;
            if (!confirmPassword.value && !password.value) {
                matchHint.textContent = 'Re-enter the password to confirm.';
                matchHint.classList.remove('text-green-600', 'text-red-600');
                matchHint.classList.add('text-gray-500');
                return;
            }

            if (confirmPassword.value === password.value) {
                matchHint.textContent = 'Passwords match.';
                matchHint.classList.remove('text-gray-500', 'text-red-600');
                matchHint.classList.add('text-green-600');
            } else {
                matchHint.textContent = 'Passwords do not match.';
                matchHint.classList.remove('text-gray-500', 'text-green-600');
                matchHint.classList.add('text-red-600');
            }
        };

        if (password) password.addEventListener('input', updateMatchHint);
        if (confirmPassword) confirmPassword.addEventListener('input', updateMatchHint);

        // Permission selection UI
        const userDetailsForm = document.getElementById('userDetailsForm');
        const permissionsForm = document.getElementById('permissionsForm');
        const nextToPermissionsBtn = document.getElementById('nextToPermissionsBtn');
        const backToUserDetailsBtn = document.getElementById('backToUserDetailsBtn');
        const roleSelect = document.getElementById('role');
        const form = document.querySelector('form');
        const permissionsTitle = document.getElementById('permissionsTitle');
        const permissionsDescription = document.getElementById('permissionsDescription');
        const dashboardPermissionLabel = document.getElementById('dashboardPermissionLabel');
        const securityDescription = document.getElementById('securityDescription');
        const accountInfoDescription = document.getElementById('accountInfoDescription');
        const createUserBtn = document.getElementById('createUserBtn');

        // Function to update permissions UI based on role
        function updatePermissionsUI(role) {
            if (role === 'manager') {
                if (permissionsTitle) permissionsTitle.textContent = 'Manager Permissions';
                if (permissionsDescription) permissionsDescription.textContent = 'Select the permissions you want to grant to this manager.';
                if (dashboardPermissionLabel) dashboardPermissionLabel.classList.remove('hidden');
                if (securityDescription) securityDescription.textContent = 'Allow the manager to access the security settings page';
                if (accountInfoDescription) accountInfoDescription.textContent = 'Allow the manager to access and update account information';
                if (createUserBtn) createUserBtn.textContent = 'Create Manager';
            } else if (role === 'editor') {
                if (permissionsTitle) permissionsTitle.textContent = 'Editor Permissions';
                if (permissionsDescription) permissionsDescription.textContent = 'Select the permissions you want to grant to this editor.';
                if (dashboardPermissionLabel) dashboardPermissionLabel.classList.add('hidden');
                if (securityDescription) securityDescription.textContent = 'Allow the editor to access the security settings page';
                if (accountInfoDescription) accountInfoDescription.textContent = 'Allow the editor to access and update account information';
                if (createUserBtn) createUserBtn.textContent = 'Create Editor';
            }
        }

        // Handle "Add User" button click
        if (nextToPermissionsBtn) {
            nextToPermissionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Validate form first
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                const role = roleSelect ? roleSelect.value : '';
                
                // If role is manager or editor, show permissions screen
                if (role === 'manager' || role === 'editor') {
                    updatePermissionsUI(role);
                    userDetailsForm.classList.add('hidden');
                    permissionsForm.classList.remove('hidden');
                } else {
                    // For other roles, submit directly
                    form.submit();
                }
            });
        }

        // Handle "Back" button click
        if (backToUserDetailsBtn) {
            backToUserDetailsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                permissionsForm.classList.add('hidden');
                userDetailsForm.classList.remove('hidden');
            });
        }

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
            const added = notifyNode.getAttribute('data-added') === 'true';
            const successMessage = notifyNode.getAttribute('data-success-message');
            const errorsRaw = notifyNode.getAttribute('data-errors');
            
            if (added && successMessage) {
                showNotification(successMessage, 'success');
                // Reset form after successful addition
                setTimeout(() => {
                    if (form) {
                        form.reset();
                        // Reset UI state
                        if (userDetailsForm) userDetailsForm.classList.remove('hidden');
                        if (permissionsForm) permissionsForm.classList.add('hidden');
                    }
                    if (matchHint) {
                        matchHint.textContent = 'Re-enter the password to confirm.';
                        matchHint.classList.remove('text-green-600', 'text-red-600');
                        matchHint.classList.add('text-gray-500');
                    }
                }, 1000);
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

