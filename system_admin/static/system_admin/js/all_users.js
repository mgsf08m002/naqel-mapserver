(function() {
    'use strict';

    const PAGE_SIZE = 8;

    const state = {
        users: [],
        filteredUsers: [],
        searchQuery: '',
        roleFilter: '',
        statusFilter: '',
        sortBy: 'newest',
        page: 1,
        visibleColumns: {
            role: true,
            status: true,
            created: true,
            last_login: true
        }
    };

    const elements = {
        loadingState: document.getElementById('loadingState'),
        emptyState: document.getElementById('emptyState'),
        usersList: document.getElementById('usersList'),
        pagination: document.getElementById('pagination'),
        roleFilter: document.getElementById('roleFilter'),
        statusFilter: document.getElementById('statusFilter'),
        sortSelect: document.getElementById('sortSelect'),
        searchInput: document.getElementById('searchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        columnCustomizeBtn: document.getElementById('columnCustomizeBtn'),
        columnCustomizeMenu: document.getElementById('columnCustomizeMenu'),
        columnToggles: document.querySelectorAll('.column-toggle'),
        resultsCount: document.getElementById('resultsCount')
    };

    function init() {
        setupEventListeners();
        loadSavedPreferences();
        loadUsers();
    }

    function setupEventListeners() {
        let searchTimeout;
        elements.searchInput?.addEventListener('input', (event) => {
            clearTimeout(searchTimeout);
            state.searchQuery = event.target.value.trim().toLowerCase();
            elements.clearSearchBtn?.classList.toggle('is-hidden', !state.searchQuery);
            searchTimeout = setTimeout(() => {
                state.page = 1;
                applyFilters();
                savePreferences();
            }, 250);
        });

        elements.clearSearchBtn?.addEventListener('click', () => {
            state.searchQuery = '';
            if (elements.searchInput) {
                elements.searchInput.value = '';
            }
            elements.clearSearchBtn.classList.add('is-hidden');
            state.page = 1;
            applyFilters();
            savePreferences();
        });

        elements.roleFilter?.addEventListener('change', (event) => {
            state.roleFilter = event.target.value;
            state.page = 1;
            applyFilters();
            savePreferences();
        });

        elements.statusFilter?.addEventListener('change', (event) => {
            state.statusFilter = event.target.value;
            state.page = 1;
            applyFilters();
            savePreferences();
        });

        elements.sortSelect?.addEventListener('change', (event) => {
            state.sortBy = event.target.value;
            state.page = 1;
            applyFilters();
            savePreferences();
        });

        elements.columnCustomizeBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            elements.columnCustomizeMenu?.classList.toggle('is-hidden');
        });

        document.addEventListener('click', (event) => {
            if (!elements.columnCustomizeBtn?.contains(event.target) &&
                !elements.columnCustomizeMenu?.contains(event.target)) {
                elements.columnCustomizeMenu?.classList.add('is-hidden');
            }
            if (!event.target.closest('.all-users-row__menu')) {
                closeOverflowMenus();
            }
        });

        elements.columnToggles.forEach((toggle) => {
            toggle.addEventListener('change', (event) => {
                const column = event.target.dataset.column;
                state.visibleColumns[column] = event.target.checked;
                renderUsers();
                savePreferences();
            });
        });

        elements.usersList?.addEventListener('click', (event) => {
            const menuBtn = event.target.closest('[data-overflow-toggle]');
            if (menuBtn) {
                event.stopPropagation();
                const menu = menuBtn.parentElement.querySelector('.all-users-row__dropdown');
                const wasOpen = menu && !menu.classList.contains('is-hidden');
                closeOverflowMenus();
                if (menu && !wasOpen) {
                    menu.classList.remove('is-hidden');
                }
            }
        });

        elements.pagination?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-page]');
            if (!button) {
                return;
            }
            const nextPage = Number(button.dataset.page);
            if (Number.isNaN(nextPage) || nextPage === state.page) {
                return;
            }
            state.page = nextPage;
            renderUsers();
        });
    }

    async function loadUsers() {
        try {
            elements.loadingState?.classList.remove('is-hidden');
            elements.emptyState?.classList.add('is-hidden');
            elements.usersList?.classList.add('is-hidden');

            const response = await fetch('/system-admin/api/users/');
            if (!response.ok) {
                throw new Error('Failed to load users');
            }

            const data = await response.json();
            state.users = data.users || [];
            applyFilters();
        } catch (error) {
            showError('Failed to load users. Please try again.');
        } finally {
            elements.loadingState?.classList.add('is-hidden');
        }
    }

    function applyFilters() {
        let filtered = state.users.filter((user) => {
            if (state.roleFilter === 'system_admin') {
                return user.is_superuser;
            }
            if (state.roleFilter) {
                return user.role === state.roleFilter;
            }
            return true;
        });

        if (state.statusFilter === 'active') {
            filtered = filtered.filter((user) => user.is_active);
        } else if (state.statusFilter === 'inactive') {
            filtered = filtered.filter((user) => !user.is_active);
        }

        if (state.searchQuery) {
            filtered = filtered.filter((user) => {
                const haystack = [
                    user.full_name || '',
                    user.email || '',
                    roleLabel(user)
                ].join(' ').toLowerCase();
                return haystack.includes(state.searchQuery);
            });
        }

        filtered = sortUsers(filtered);
        state.filteredUsers = filtered;
        const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (state.page > pageCount) {
            state.page = pageCount;
        }
        updateResultsCounter();
        renderUsers();
    }

    function sortUsers(users) {
        const sorted = users.slice();
        if (state.sortBy === 'oldest') {
            return sorted.reverse();
        }
        if (state.sortBy === 'name_asc' || state.sortBy === 'name_desc') {
            sorted.sort((a, b) => {
                const left = (a.full_name || a.email || '').toLowerCase();
                const right = (b.full_name || b.email || '').toLowerCase();
                return left.localeCompare(right);
            });
            if (state.sortBy === 'name_desc') {
                sorted.reverse();
            }
        }
        return sorted;
    }

    function updateResultsCounter() {
        if (elements.resultsCount) {
            elements.resultsCount.textContent = String(state.filteredUsers.length);
        }
    }

    function renderUsers() {
        closeOverflowMenus();

        if (!state.filteredUsers.length) {
            elements.emptyState?.classList.remove('is-hidden');
            elements.usersList?.classList.add('is-hidden');
            elements.pagination?.classList.add('is-hidden');
            if (elements.usersList) {
                elements.usersList.innerHTML = '';
            }
            return;
        }

        elements.emptyState?.classList.add('is-hidden');
        elements.usersList?.classList.remove('is-hidden');

        const start = (state.page - 1) * PAGE_SIZE;
        const pageUsers = state.filteredUsers.slice(start, start + PAGE_SIZE);
        elements.usersList.innerHTML = pageUsers.map(renderUserRow).join('');
        renderPagination();
    }

    function renderUserRow(user) {
        const initials = getUserInitials(user);
        const name = escapeHtml(user.full_name || user.email);
        const email = escapeHtml(user.email);
        const role = escapeHtml(roleLabel(user));
        const created = escapeHtml(formatCreated(user));
        const lastLogin = escapeHtml(user.last_login_display || user.last_login || 'Never');
        const avatar = user.profile_image
            ? `<img src="${escapeHtml(user.profile_image)}" alt="">`
            : `<span>${escapeHtml(initials)}</span>`;

        return `
            <article class="all-users-row">
                <div class="all-users-row__identity">
                    <div class="all-users-row__avatar">${avatar}</div>
                    <div class="all-users-row__who">
                        <h2>${name}</h2>
                        <p>${email}</p>
                        ${state.visibleColumns.role ? `
                        <span class="all-users-role">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                            </svg>
                            ${role}
                        </span>` : ''}
                    </div>
                </div>
                <div class="all-users-row__dates">
                    ${state.visibleColumns.created ? `
                    <p>
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <span><small>Created</small>${created}</span>
                    </p>` : ''}
                    ${state.visibleColumns.last_login ? `
                    <p>
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span><small>Last Login</small>${lastLogin}</span>
                    </p>` : ''}
                </div>
                <div class="all-users-row__status">
                    ${state.visibleColumns.status ? `
                    <span class="all-users-status ${user.is_active ? 'is-active' : 'is-inactive'}">
                        <small>Status</small>
                        <strong><span class="users-status-dot ${user.is_active ? '' : 'is-inactive'}"></span>${user.is_active ? 'Active' : 'Inactive'}</strong>
                    </span>` : ''}
                </div>
                <div class="all-users-row__actions">
                    <div class="all-users-row__menu">
                        <button type="button" class="all-users-icon-btn" data-overflow-toggle aria-label="More actions">
                            <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="5" cy="12" r="1.7"></circle>
                                <circle cx="12" cy="12" r="1.7"></circle>
                                <circle cx="19" cy="12" r="1.7"></circle>
                            </svg>
                        </button>
                        <div class="all-users-row__dropdown is-hidden">
                            <a href="/system-admin/users/edit/${user.id}/">Edit user</a>
                            <a href="/system-admin/users/delete/${user.id}/" class="is-danger">Delete user</a>
                        </div>
                    </div>
                    <a class="all-users-view" href="/system-admin/users/view/${user.id}/">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                        </svg>
                        View Details
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </a>
                </div>
            </article>
        `;
    }

    function renderPagination() {
        const pageCount = Math.max(1, Math.ceil(state.filteredUsers.length / PAGE_SIZE));

        const pages = [];
        pages.push(`<button type="button" class="all-users-page-btn" data-page="${Math.max(1, state.page - 1)}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
        </button>`);

        for (let page = 1; page <= pageCount; page += 1) {
            pages.push(`<button type="button" class="all-users-page-btn ${page === state.page ? 'is-current' : ''}" data-page="${page}">${page}</button>`);
        }

        pages.push(`<button type="button" class="all-users-page-btn" data-page="${Math.min(pageCount, state.page + 1)}" ${state.page === pageCount ? 'disabled' : ''} aria-label="Next page">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </button>`);

        if (!elements.pagination) {
            return;
        }
        elements.pagination.classList.remove('is-hidden');
        elements.pagination.innerHTML = pages.join('');
    }

    function roleLabel(user) {
        if (user.is_superuser || user.role === 'system_admin') {
            return 'System Admin';
        }
        if (user.role) {
            return user.role.charAt(0).toUpperCase() + user.role.slice(1);
        }
        return 'Not assigned';
    }

    function formatCreated(user) {
        if (user.created_display) {
            return user.created_display;
        }
        if (user.account_creation_date && user.account_creation_time) {
            return `${user.account_creation_date} at ${user.account_creation_time}`;
        }
        return user.date_joined || '—';
    }

    function getUserInitials(user) {
        if (user.full_name) {
            const parts = user.full_name.trim().split(/\s+/);
            if (parts.length >= 2) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            }
            return parts[0][0].toUpperCase();
        }
        return (user.email || 'U')[0].toUpperCase();
    }

    function escapeHtml(text) {
        if (!text) {
            return '';
        }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showError(message) {
        elements.emptyState?.classList.remove('is-hidden');
        const text = elements.emptyState?.querySelector('p');
        if (text) {
            text.textContent = message;
        }
    }

    function closeOverflowMenus() {
        document.querySelectorAll('.all-users-row__dropdown').forEach((menu) => {
            menu.classList.add('is-hidden');
        });
    }

    function loadSavedPreferences() {
        try {
            localStorage.removeItem('allUsersView');

            const savedFilter = localStorage.getItem('allUsersRoleFilter');
            if (savedFilter && elements.roleFilter) {
                state.roleFilter = savedFilter;
                elements.roleFilter.value = savedFilter;
            }

            const savedStatus = localStorage.getItem('allUsersStatusFilter');
            if (savedStatus && elements.statusFilter) {
                state.statusFilter = savedStatus;
                elements.statusFilter.value = savedStatus;
            }

            const savedSort = localStorage.getItem('allUsersSort');
            if (savedSort && elements.sortSelect) {
                state.sortBy = savedSort;
                elements.sortSelect.value = savedSort;
            }

            const savedSearch = localStorage.getItem('allUsersSearchQuery');
            if (savedSearch && elements.searchInput) {
                state.searchQuery = savedSearch.toLowerCase();
                elements.searchInput.value = savedSearch;
                elements.clearSearchBtn?.classList.toggle('is-hidden', !savedSearch);
            }

            const savedColumns = localStorage.getItem('allUsersVisibleColumns');
            if (savedColumns) {
                const parsed = JSON.parse(savedColumns);
                Object.keys(state.visibleColumns).forEach((column) => {
                    if (Object.prototype.hasOwnProperty.call(parsed, column)) {
                        state.visibleColumns[column] = Boolean(parsed[column]);
                    }
                });
                elements.columnToggles.forEach((toggle) => {
                    const column = toggle.dataset.column;
                    if (Object.prototype.hasOwnProperty.call(state.visibleColumns, column)) {
                        toggle.checked = state.visibleColumns[column];
                    }
                });
            }
        } catch (error) {
            // Keep defaults if stored preferences are invalid.
        }
    }

    function savePreferences() {
        try {
            localStorage.setItem('allUsersRoleFilter', state.roleFilter);
            localStorage.setItem('allUsersStatusFilter', state.statusFilter);
            localStorage.setItem('allUsersSort', state.sortBy);
            localStorage.setItem('allUsersSearchQuery', elements.searchInput?.value || '');
            localStorage.setItem('allUsersVisibleColumns', JSON.stringify(state.visibleColumns));
        } catch (error) {
            // Ignore storage failures.
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
