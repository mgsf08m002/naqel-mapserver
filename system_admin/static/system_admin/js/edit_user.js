(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const accountStatusSelect = document.getElementById('account_status');
        const statusWrap = document.querySelector('.users-status-select');

        if (!accountStatusSelect || !statusWrap) {
            return;
        }

        const syncStatusDot = (value) => {
            const isActive = value === 'active';
            statusWrap.classList.toggle('is-active', isActive);
            statusWrap.classList.toggle('is-inactive', !isActive);
        };

        syncStatusDot(accountStatusSelect.value);
        accountStatusSelect.addEventListener('change', function() {
            syncStatusDot(this.value);
            if (this.value === 'inactive' && window.notify && typeof window.notify.tryShow === 'function') {
                window.notify.tryShow(
                    (typeof window.uiT === 'function'
                        ? window.uiT('toast_inactive_users', "Inactive users can't sign in")
                        : "Inactive users can't sign in"),
                    'warning'
                );
            }
        });
    });
})();
