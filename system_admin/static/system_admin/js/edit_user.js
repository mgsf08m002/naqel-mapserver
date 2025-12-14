(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const searchNotifyNode = document.getElementById('editUserSearchNotify');
        const updateNotifyNode = document.getElementById('editUserNotify');
        const accountStatusSelect = document.getElementById('account_status');

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

        // Handle search notifications
        if (searchNotifyNode) {
            const errorsRaw = searchNotifyNode.getAttribute('data-errors');
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) showNotification(trimmed, 'error');
                });
            }
        }

        // Handle update notifications
        if (updateNotifyNode) {
            const updated = updateNotifyNode.getAttribute('data-updated') === 'true';
            const successMessage = updateNotifyNode.getAttribute('data-success-message');
            const errorsRaw = updateNotifyNode.getAttribute('data-errors');
            
            if (updated && successMessage) {
                showNotification(successMessage, 'success');
            }
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) showNotification(trimmed, 'error');
                });
            }
        }

        // Show warning when account status is set to inactive
        if (accountStatusSelect) {
            accountStatusSelect.addEventListener('change', function() {
                if (this.value === 'inactive') {
                    showNotification('Setting account status to Inactive will prevent this user from logging in.', 'warning');
                }
            });
        }
    });
})();

