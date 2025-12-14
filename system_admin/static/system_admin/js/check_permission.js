/**
 * Check Permission JavaScript
 * Handles form submission and notifications for updating permissions
 */

(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('checkPermissionForm');
        const notifyNode = document.getElementById('checkPermissionNotify');

        /**
         * Show notification
         */
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

        /**
         * Handle form submission - allow normal form submission
         * The form will submit normally and Django will handle it
         */

        // Check for success message on page load (after form submission)
        if (notifyNode) {
            const success = notifyNode.getAttribute('data-success') === 'true';
            const successMessage = notifyNode.getAttribute('data-success-message');
            const errorsRaw = notifyNode.getAttribute('data-errors');
            
            if (success && successMessage) {
                showNotification(successMessage, 'success');
                // Redirect to permissions page after showing notification
                setTimeout(() => {
                    window.location.href = '/system-admin/permissions/';
                }, 1500);
            }
            
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) showNotification(trimmed, 'error');
                });
            }
        }
        
        // Handle form submission
        if (form) {
            form.addEventListener('submit', (e) => {
                // Allow normal form submission - Django will handle it
                // The page will reload with success message if successful
            });
        }
    });
})();

