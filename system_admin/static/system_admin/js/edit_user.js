(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const searchNotifyNode = document.getElementById('editUserSearchNotify');
        const updateNotifyNode = document.getElementById('editUserNotify');
        const accountStatusSelect = document.getElementById('account_status');

        // Handle search notifications
        if (searchNotifyNode) {
            const errorsRaw = searchNotifyNode.getAttribute('data-errors');
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) window.notify.tryShow(trimmed, 'error');
                });
            }
        }

        // Handle update notifications
        if (updateNotifyNode) {
            const updated = updateNotifyNode.getAttribute('data-updated') === 'true';
            const successMessage = updateNotifyNode.getAttribute('data-success-message');
            const errorsRaw = updateNotifyNode.getAttribute('data-errors');
            
            if (updated && successMessage) {
                window.notify.tryShow(successMessage, 'success');
            }
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) window.notify.tryShow(trimmed, 'error');
                });
            }
        }

        // Show warning when account status is set to inactive
        if (accountStatusSelect) {
            accountStatusSelect.addEventListener('change', function() {
                if (this.value === 'inactive') {
                    window.notify.tryShow('Setting account status to Inactive will prevent this user from logging in.', 'warning');
                }
            });
        }
    });
})();

