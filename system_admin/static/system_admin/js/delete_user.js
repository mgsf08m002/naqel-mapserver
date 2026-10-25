(function() {
    'use strict';

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
                    title: 'Delete user',
                    message:
                        'Are you sure you want to delete this user? This action cannot be undone and will permanently delete the user and all associated data.',
                    confirmLabel: 'Delete',
                    cancelLabel: 'Cancel',
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
