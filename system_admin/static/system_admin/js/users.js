(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('recentUsersSearch');
        const filterBtn = document.getElementById('usersFilterBtn');
        const filterMenu = document.getElementById('usersFilterMenu');
        const tableBody = document.getElementById('recentUsersTableBody');
        const emptyState = document.getElementById('recentUsersEmpty');
        const rows = tableBody ? Array.from(tableBody.querySelectorAll('tr[data-name]')) : [];

        let statusFilter = 'all';

        function applyFilters() {
            const query = (searchInput?.value || '').trim().toLowerCase();
            let visibleCount = 0;

            rows.forEach((row) => {
                const haystack = [
                    row.dataset.name,
                    row.dataset.email,
                    row.dataset.role
                ].join(' ');
                const matchesQuery = !query || haystack.includes(query);
                const matchesStatus = statusFilter === 'all' || row.dataset.status === statusFilter;
                const visible = matchesQuery && matchesStatus;
                row.classList.toggle('is-hidden', !visible);
                if (visible) {
                    visibleCount += 1;
                }
            });

            if (emptyState) {
                emptyState.hidden = visibleCount !== 0 || rows.length === 0;
            }
        }

        searchInput?.addEventListener('input', applyFilters);

        filterBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            const isOpen = filterMenu?.classList.toggle('is-open');
            filterBtn.classList.toggle('is-open', Boolean(isOpen));
            filterBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            closeRowMenus();
        });

        filterMenu?.querySelectorAll('button[data-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                statusFilter = button.getAttribute('data-filter') || 'all';
                filterMenu.querySelectorAll('button[data-filter]').forEach((item) => {
                    item.classList.toggle('is-active', item === button);
                });
                filterMenu.classList.remove('is-open');
                filterBtn?.classList.remove('is-open');
                filterBtn?.setAttribute('aria-expanded', 'false');
                applyFilters();
            });
        });

        function closeRowMenus(exceptMenu) {
            document.querySelectorAll('.users-row-actions__menu.is-open').forEach((menu) => {
                if (menu !== exceptMenu) {
                    menu.classList.remove('is-open');
                    menu.previousElementSibling?.classList.remove('is-open');
                }
            });
        }

        document.querySelectorAll('.users-row-actions__btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const menu = button.nextElementSibling;
                const willOpen = !menu?.classList.contains('is-open');
                closeRowMenus(willOpen ? menu : null);
                filterMenu?.classList.remove('is-open');
                filterBtn?.classList.remove('is-open');
                menu?.classList.toggle('is-open', willOpen);
                button.classList.toggle('is-open', willOpen);
            });
        });

        document.addEventListener('click', () => {
            filterMenu?.classList.remove('is-open');
            filterBtn?.classList.remove('is-open');
            filterBtn?.setAttribute('aria-expanded', 'false');
            closeRowMenus();
        });
    });
})();
