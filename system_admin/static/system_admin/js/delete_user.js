(function() {
    'use strict';

    function t(key, fallback) {
        return typeof window.uiT === 'function' ? window.uiT(key, fallback) : fallback;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const deleteForm = document.getElementById('delete-user-form');
        if (!deleteForm || !window.notify || typeof window.notify.confirm !== 'function') {
            return;
        }

        let confirmed = false;
        deleteForm.addEventListener('submit', function(event) {
            if (confirmed) {
                return;
            }
            event.preventDefault();
            window.notify
                .confirm({
                    title: t('delete_user_confirm_title', 'Delete user'),
                    message: t(
                        'delete_user_confirm_message',
                        'Are you sure you want to delete this user? This action cannot be undone and will permanently delete the user and all associated data.'
                    ),
                    confirmLabel: t('delete_user_confirm_ok', 'Delete'),
                    cancelLabel: t('cancel', 'Cancel'),
                    variant: 'danger',
                })
                .then(function(ok) {
                    if (ok) {
                        confirmed = true;
                        deleteForm.requestSubmit();
                    }
                });
        });
    });
})();
