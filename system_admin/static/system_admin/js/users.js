(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('recentUsersSearch');
        const filterBtn = document.getElementById('usersFilterBtn');
        const filterMenu = document.getElementById('usersFilterMenu');
        const tableBody = document.getElementById('recentUsersTableBody');
        const emptyState = document.getElementById('recentUsersEmpty');
        const rows = tableBody ? Array.from(tableBody.querySelectorAll('tr[data-name]')) : [];
        const scrollRoot = document.querySelector('main');

        let statusFilter = 'all';
        let activeMenu = null;
        let activeButton = null;
        let activeHome = null;

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

        function clearMenuPosition(menu) {
            if (!menu) {
                return;
            }
            menu.style.top = '';
            menu.style.left = '';
            menu.style.right = '';
        }

        function restoreActiveMenu() {
            if (!activeMenu || !activeHome) {
                return;
            }
            activeMenu.classList.remove('is-open');
            activeButton?.classList.remove('is-open');
            clearMenuPosition(activeMenu);
            activeHome.appendChild(activeMenu);
            activeMenu = null;
            activeButton = null;
            activeHome = null;
        }

        function positionRowMenu(button, menu) {
            const rect = button.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const gap = 4;
            const pad = 8;
            const menuWidth = menuRect.width || 132;
            const menuHeight = menuRect.height || 120;
            const isRtl = document.documentElement.getAttribute('dir') === 'rtl';

            let top = rect.bottom + gap;
            if (top + menuHeight > window.innerHeight - pad) {
                top = Math.max(pad, rect.top - gap - menuHeight);
            }

            let left;
            if (isRtl) {
                left = rect.left;
                if (left + menuWidth > window.innerWidth - pad) {
                    left = window.innerWidth - menuWidth - pad;
                }
            } else {
                left = rect.right - menuWidth;
                if (left < pad) {
                    left = pad;
                }
            }

            menu.style.top = `${Math.round(top)}px`;
            menu.style.left = `${Math.round(left)}px`;
            menu.style.right = 'auto';
        }

        function closeRowMenus() {
            restoreActiveMenu();
        }

        function openRowMenu(button, menu) {
            closeRowMenus();
            activeButton = button;
            activeMenu = menu;
            activeHome = menu.parentElement;
            document.body.appendChild(menu);
            menu.classList.add('is-open');
            button.classList.add('is-open');
            positionRowMenu(button, menu);
        }

        document.querySelectorAll('.users-row-actions__btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const menu = button.nextElementSibling || (
                    activeButton === button ? activeMenu : null
                );
                if (!menu) {
                    return;
                }
                filterMenu?.classList.remove('is-open');
                filterBtn?.classList.remove('is-open');
                filterBtn?.setAttribute('aria-expanded', 'false');

                const isAlreadyOpen = activeButton === button && activeMenu === menu;
                if (isAlreadyOpen) {
                    closeRowMenus();
                    return;
                }
                openRowMenu(button, menu);
            });
        });

        document.addEventListener('click', (event) => {
            if (activeMenu && activeMenu.contains(event.target)) {
                return;
            }
            filterMenu?.classList.remove('is-open');
            filterBtn?.classList.remove('is-open');
            filterBtn?.setAttribute('aria-expanded', 'false');
            closeRowMenus();
        });

        scrollRoot?.addEventListener('scroll', () => closeRowMenus(), { passive: true });
        window.addEventListener('resize', () => closeRowMenus());
    });
})();
