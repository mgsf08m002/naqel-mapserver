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
         * Handle form submission - allow normal form submission
         * The form will submit normally and Django will handle it
         */

        // Check for success message on page load (after form submission)
        if (notifyNode) {
            const success = notifyNode.getAttribute('data-success') === 'true';
            const successMessage = notifyNode.getAttribute('data-success-message');
            const errorsRaw = notifyNode.getAttribute('data-errors');
            
            if (success && successMessage) {
                window.notify.tryShow(successMessage, 'success');
                // Redirect to permissions page after showing notification
                setTimeout(() => {
                    window.location.href = '/system-admin/permissions/';
                }, 1500);
            }
            
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) window.notify.tryShow(trimmed, 'error');
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

