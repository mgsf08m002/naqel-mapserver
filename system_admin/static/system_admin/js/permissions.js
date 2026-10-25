(function () {
    'use strict';

    const state = {
        users: [],
        filteredUsers: [],
        searchQuery: '',
        roleFilter: '',
    };

    const elements = {
        loadingState: document.getElementById('loadingState'),
        emptyState: document.getElementById('emptyState'),
        usersGrid: document.getElementById('usersGrid'),
        searchInput: document.getElementById('searchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        roleFilter: document.getElementById('roleFilter'),
        resultsCount: document.getElementById('resultsCount'),
    };

    function initials(name) {
        const first = String(name || '').trim().split(/\s+/).filter(Boolean)[0] || 'U';
        return first.slice(0, 2).toUpperCase();
    }

    function roleLabel(role) {
        if (!role) return 'Not assigned';
        return role.charAt(0).toUpperCase() + role.slice(1);
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function setHidden(el, hidden) {
        if (!el) return;
        el.classList.toggle('is-hidden', hidden);
    }

    function showLoading() {
        setHidden(elements.loadingState, false);
        setHidden(elements.emptyState, true);
        setHidden(elements.usersGrid, true);
    }

    function hideLoading() {
        setHidden(elements.loadingState, true);
    }

    function updateResultsCount() {
        if (elements.resultsCount) {
            elements.resultsCount.textContent = String(state.filteredUsers.length);
        }
    }

    function permissionUrl(user) {
        return user.has_permissions
            ? `/system-admin/permissions/check/${user.id}/`
            : `/system-admin/permissions/grant/${user.id}/`;
    }

    function renderCards() {
        if (!elements.usersGrid) return;

        if (!state.filteredUsers.length) {
            setHidden(elements.emptyState, false);
            setHidden(elements.usersGrid, true);
            return;
        }

        setHidden(elements.emptyState, true);
        setHidden(elements.usersGrid, false);
        elements.usersGrid.innerHTML = state.filteredUsers.map((user) => {
            const name = user.full_name || user.email || 'User';
            return `
                <article class="permissions-card">
                    <div class="permissions-card__top">
                        <div class="permissions-avatar">${escapeHtml(initials(name))}</div>
                        <div class="permissions-card__identity">
                            <h2 class="permissions-card__name">${escapeHtml(name)}</h2>
                            <p class="permissions-card__email">${escapeHtml(user.email || '')}</p>
                            <span class="permissions-role">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                                </svg>
                                ${escapeHtml(roleLabel(user.role))}
                            </span>
                        </div>
                    </div>
                    <a class="permissions-card__action" href="${permissionUrl(user)}">
                        <span class="permissions-card__action-icon" aria-hidden="true">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                            </svg>
                        </span>
                        <span class="permissions-card__action-copy">
                            <span class="permissions-card__action-title">User Permissions</span>
                            <span class="permissions-card__action-desc">View and manage permissions for this user</span>
                        </span>
                        <span class="permissions-card__chevron" aria-hidden="true">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                            </svg>
                        </span>
                    </a>
                </article>
            `;
        }).join('');
    }

    function applyFilters() {
        let filtered = state.users.filter((user) => user.role === 'manager' || user.role === 'editor');

        if (state.searchQuery) {
            filtered = filtered.filter((user) => {
                const haystack = `${user.full_name || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase();
                return haystack.includes(state.searchQuery);
            });
        }

        if (state.roleFilter) {
            filtered = filtered.filter((user) => user.role === state.roleFilter);
        }

        state.filteredUsers = filtered;
        updateResultsCount();
        hideLoading();
        renderCards();
    }

    async function fetchUsers() {
        try {
            showLoading();
            const response = await fetch('/system-admin/api/permissions/');
            const data = await response.json();
            if (data.success) {
                state.users = data.users || [];
                applyFilters();
            } else {
                hideLoading();
                window.notify.tryShow('Failed to load users: ' + data.message, 'error');
            }
        } catch (error) {
            hideLoading();
            window.notify.tryShow('Error loading users: ' + error.message, 'error');
        }
    }

    function setupEventListeners() {
        if (elements.searchInput) {
            let searchTimeout;
            elements.searchInput.addEventListener('input', (event) => {
                clearTimeout(searchTimeout);
                state.searchQuery = event.target.value.trim().toLowerCase();
                setHidden(elements.clearSearchBtn, !state.searchQuery);
                searchTimeout = setTimeout(applyFilters, 250);
            });
        }

        if (elements.clearSearchBtn) {
            elements.clearSearchBtn.addEventListener('click', () => {
                if (elements.searchInput) elements.searchInput.value = '';
                state.searchQuery = '';
                setHidden(elements.clearSearchBtn, true);
                applyFilters();
            });
        }

        if (elements.roleFilter) {
            elements.roleFilter.addEventListener('change', (event) => {
                state.roleFilter = event.target.value;
                applyFilters();
            });
        }
    }

    function init() {
        setupEventListeners();
        fetchUsers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
