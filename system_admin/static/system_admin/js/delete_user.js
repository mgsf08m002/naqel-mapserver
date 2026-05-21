(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const searchNotifyNode = document.getElementById('deleteUserSearchNotify');
        const deleteNotifyNode = document.getElementById('deleteUserNotify');
        const deleteForm = document.querySelector('form[method="post"] input[name="intent"][value="delete_user"]')?.closest('form');

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

        // Handle delete notifications
        if (deleteNotifyNode) {
            const deleted = deleteNotifyNode.getAttribute('data-deleted') === 'true';
            const successMessage = deleteNotifyNode.getAttribute('data-success-message');
            const errorsRaw = deleteNotifyNode.getAttribute('data-errors');
            
            if (deleted && successMessage) {
                window.notify.tryShow(successMessage, 'success');
                // Redirect to users page after a delay
                setTimeout(() => {
                    window.location.href = '/system-admin/users/';
                }, 2000);
            }
            if (errorsRaw) {
                errorsRaw.split('||').forEach(err => {
                    const trimmed = err.trim();
                    if (trimmed) window.notify.tryShow(trimmed, 'error');
                });
            }
        }

        // Confirm deletion before submitting
        if (deleteForm) {
            let deleteConfirmBypass = false;
            deleteForm.addEventListener('submit', function(e) {
                if (deleteConfirmBypass) {
                    return;
                }
                e.preventDefault();
                const submitDelete = function () {
                    deleteConfirmBypass = true;
                    deleteForm.requestSubmit();
                };
                window.notify
                    .confirm({
                        title: 'Delete user',
                        message:
                            'Are you sure you want to delete this user? This action cannot be undone and will permanently delete the user and all associated data.',
                        confirmLabel: 'Delete',
                        cancelLabel: 'Cancel',
                        variant: 'danger',
                    })
                    .then(function (ok) {
                        if (ok) {
                            submitDelete();
                        }
                    });
            });
        }
    });
})();

