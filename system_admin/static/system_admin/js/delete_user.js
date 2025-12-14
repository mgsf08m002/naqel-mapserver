(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const searchNotifyNode = document.getElementById('deleteUserSearchNotify');
        const deleteNotifyNode = document.getElementById('deleteUserNotify');
        const deleteForm = document.querySelector('form[method="post"] input[name="intent"][value="delete_user"]')?.closest('form');

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

        // Handle delete notifications
        if (deleteNotifyNode) {
            const deleted = deleteNotifyNode.getAttribute('data-deleted') === 'true';
            const successMessage = deleteNotifyNode.getAttribute('data-success-message');
            const errorsRaw = deleteNotifyNode.getAttribute('data-errors');
            
            if (deleted && successMessage) {
                showNotification(successMessage, 'success');
                // Redirect to users page after a delay
                setTimeout(() => {
                    window.location.href = '/system-admin/users/';
                }, 2000);
            }
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) showNotification(trimmed, 'error');
                });
            }
        }

        // Confirm deletion before submitting
        if (deleteForm) {
            deleteForm.addEventListener('submit', function(e) {
                const confirmed = confirm('Are you sure you want to delete this user? This action cannot be undone and will permanently delete the user and all associated data.');
                if (!confirmed) {
                    e.preventDefault();
                    return false;
                }
            });
        }
    });
})();

