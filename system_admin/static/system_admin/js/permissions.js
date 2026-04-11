/**
 * Permissions Management JavaScript
 * Handles permissions page functionality including user listing, permission modal, and updates
 */

(function() {
    'use strict';

    // State management
    const state = {
        users: [],
        filteredUsers: [],
        currentView: 'classic',
        searchQuery: '',
        roleFilter: ''
    };

    // DOM elements
    const elements = {
        loadingState: document.getElementById('loadingState'),
        emptyState: document.getElementById('emptyState'),
        classicView: document.getElementById('classicView'),
        listView: document.getElementById('listView'),
        tableView: document.getElementById('tableView'),
        tableBody: document.getElementById('tableBody'),
        viewClassic: document.getElementById('viewClassic'),
        viewList: document.getElementById('viewList'),
        viewTable: document.getElementById('viewTable'),
        searchInput: document.getElementById('searchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        roleFilter: document.getElementById('roleFilter'),
        resultsCount: document.getElementById('resultsCount'),
    };

    /**
     * Initialize the page
     */
    function init() {
        setupEventListeners();
        // Initialize the default view (classic)
        switchView('classic');
        fetchUsers();
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // View switcher
        if (elements.viewClassic) {
            elements.viewClassic.addEventListener('click', () => switchView('classic'));
        }
        if (elements.viewList) {
            elements.viewList.addEventListener('click', () => switchView('list'));
        }
        if (elements.viewTable) {
            elements.viewTable.addEventListener('click', () => switchView('table'));
        }

        // Search input
        if (elements.searchInput) {
            let searchTimeout;
            elements.searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                state.searchQuery = e.target.value.trim().toLowerCase();
                
                if (state.searchQuery) {
                    if (elements.clearSearchBtn) {
                        elements.clearSearchBtn.classList.remove('hidden');
                    }
                } else {
                    if (elements.clearSearchBtn) {
                        elements.clearSearchBtn.classList.add('hidden');
                    }
                }
                
                searchTimeout = setTimeout(() => {
                    applyFilters();
                }, 300);
            });
        }

        // Clear search button
        if (elements.clearSearchBtn) {
            elements.clearSearchBtn.addEventListener('click', clearSearch);
        }

        // Role filter
        if (elements.roleFilter) {
            elements.roleFilter.addEventListener('change', (e) => {
                state.roleFilter = e.target.value;
                applyFilters();
            });
        }

    }

    /**
     * Switch view mode
     */
    function switchView(view) {
        state.currentView = view;

        // Update button states
        [elements.viewClassic, elements.viewList, elements.viewTable].forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
            }
        });

        if (view === 'classic' && elements.viewClassic) {
            elements.viewClassic.classList.add('active');
        } else if (view === 'list' && elements.viewList) {
            elements.viewList.classList.add('active');
        } else if (view === 'table' && elements.viewTable) {
            elements.viewTable.classList.add('active');
        }

        // Hide all views
        if (elements.classicView) elements.classicView.classList.add('hidden');
        if (elements.listView) elements.listView.classList.add('hidden');
        if (elements.tableView) elements.tableView.classList.add('hidden');

        // Show selected view
        if (view === 'classic' && elements.classicView) {
            elements.classicView.classList.remove('hidden');
        } else if (view === 'list' && elements.listView) {
            elements.listView.classList.remove('hidden');
        } else if (view === 'table' && elements.tableView) {
            elements.tableView.classList.remove('hidden');
        }

        renderCurrentView();
    }

    /**
     * Fetch users from API
     */
    async function fetchUsers() {
        try {
            showLoading();
            const response = await fetch('/system-admin/api/permissions/');
            const data = await response.json();

            if (data.success) {
                state.users = data.users;
                applyFilters();
            } else {
                window.notify.tryShow('Failed to load users: ' + data.message, 'error');
                hideLoading();
            }
        } catch (error) {
            window.notify.tryShow('Error loading users: ' + error.message, 'error');
            hideLoading();
        }
    }

    /**
     * Show loading state
     */
    function showLoading() {
        if (elements.loadingState) {
            elements.loadingState.classList.remove('hidden');
        }
        if (elements.emptyState) {
            elements.emptyState.classList.add('hidden');
        }
        if (elements.classicView) {
            elements.classicView.classList.add('hidden');
        }
        if (elements.listView) {
            elements.listView.classList.add('hidden');
        }
        if (elements.tableView) {
            elements.tableView.classList.add('hidden');
        }
    }

    /**
     * Hide loading state
     */
    function hideLoading() {
        if (elements.loadingState) {
            elements.loadingState.classList.add('hidden');
        }
    }

    /**
     * Clear search
     */
    function clearSearch() {
        if (elements.searchInput) {
            elements.searchInput.value = '';
        }
        state.searchQuery = '';
        if (elements.clearSearchBtn) {
            elements.clearSearchBtn.classList.add('hidden');
        }
        applyFilters();
    }

    /**
     * Apply filters and render
     */
    function applyFilters() {
        let filtered = state.users;

        // Filter by search query
        if (state.searchQuery) {
            filtered = filtered.filter(user => {
                const fullName = (user.full_name || '').toLowerCase();
                const email = (user.email || '').toLowerCase();
                const role = (user.role || '').toLowerCase();
                return fullName.includes(state.searchQuery) || 
                       email.includes(state.searchQuery) || 
                       role.includes(state.searchQuery);
            });
        }

        // Filter by role (only show managers and editors)
        filtered = filtered.filter(user => {
            if (!user.role || user.role === 'system_admin') {
                return false;
            }
            if (state.roleFilter) {
                return user.role === state.roleFilter;
            }
            return true;
        });

        state.filteredUsers = filtered;
        updateResultsCount();
        hideLoading();
        renderCurrentView();
    }

    /**
     * Update results count
     */
    function updateResultsCount() {
        if (elements.resultsCount) {
            elements.resultsCount.textContent = state.filteredUsers.length;
        }
    }

    /**
     * Render current view
     */
    function renderCurrentView() {
        // Ensure the current view container is visible
        if (state.currentView === 'classic' && elements.classicView) {
            elements.classicView.classList.remove('hidden');
            if (elements.listView) elements.listView.classList.add('hidden');
            if (elements.tableView) elements.tableView.classList.add('hidden');
        } else if (state.currentView === 'list' && elements.listView) {
            elements.listView.classList.remove('hidden');
            if (elements.classicView) elements.classicView.classList.add('hidden');
            if (elements.tableView) elements.tableView.classList.add('hidden');
        } else if (state.currentView === 'table' && elements.tableView) {
            elements.tableView.classList.remove('hidden');
            if (elements.classicView) elements.classicView.classList.add('hidden');
            if (elements.listView) elements.listView.classList.add('hidden');
        }

        if (state.filteredUsers.length === 0) {
            if (elements.emptyState) {
                elements.emptyState.classList.remove('hidden');
            }
            return;
        }

        if (elements.emptyState) {
            elements.emptyState.classList.add('hidden');
        }

        if (state.currentView === 'classic') {
            renderClassicView();
        } else if (state.currentView === 'list') {
            renderListView();
        } else if (state.currentView === 'table') {
            renderTableView();
        }
    }

    /**
     * Render classic view
     */
    function renderClassicView() {
        const container = elements.classicView;
        if (!container) return;

        container.innerHTML = state.filteredUsers.map(user => {
            const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Not assigned';
            const actionButtonText = user.has_permissions ? 'Check Permission(s)' : 'Grant Permission';
            const actionButtonClass = user.has_permissions 
                ? 'rounded-full border-2 border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-all duration-200'
                : 'rounded-full border-2 border-black bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-all duration-200';

            return `
                <div class="bg-white rounded-lg border-2 border-gray-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div class="space-y-3">
                        <div>
                            <h3 class="text-sm font-semibold text-gray-900">${escapeHtml(user.full_name || user.email)}</h3>
                            <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(user.email)}</p>
                        </div>
                        <div class="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span class="text-xs font-medium text-gray-700">${escapeHtml(roleDisplay)}</span>
                            <button 
                                type="button" 
                                class="${actionButtonClass}"
                                onclick="window.permissionsModule.openPermissionModal(${user.id})"
                            >
                                ${escapeHtml(actionButtonText)}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render list view
     */
    function renderListView() {
        const container = elements.listView;
        if (!container) return;

        container.innerHTML = state.filteredUsers.map(user => {
            const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Not assigned';
            const actionButtonText = user.has_permissions ? 'Check Permission(s)' : 'Grant Permission';
            const actionButtonClass = user.has_permissions 
                ? 'rounded-full border-2 border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-all duration-200'
                : 'rounded-full border-2 border-black bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-all duration-200';

            return `
                <div class="bg-white rounded-lg border-2 border-gray-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div class="flex-1">
                            <h3 class="text-sm font-semibold text-gray-900">${escapeHtml(user.full_name || user.email)}</h3>
                            <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(user.email)}</p>
                            <span class="inline-block mt-2 text-xs font-medium text-gray-700">${escapeHtml(roleDisplay)}</span>
                        </div>
                        <button 
                            type="button" 
                            class="${actionButtonClass}"
                            onclick="window.permissionsModule.openPermissionModal(${user.id})"
                        >
                            ${escapeHtml(actionButtonText)}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render table view
     */
    function renderTableView() {
        const tbody = elements.tableBody;
        if (!tbody) return;

        tbody.innerHTML = state.filteredUsers.map(user => {
            const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Not assigned';
            const actionButtonText = user.has_permissions ? 'Check Permission(s)' : 'Grant Permission';
            const actionButtonClass = user.has_permissions 
                ? 'rounded-full border-2 border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-all duration-200'
                : 'rounded-full border-2 border-black bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-all duration-200';

            return `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors duration-150">
                    <td class="py-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                        ${escapeHtml(user.full_name || user.email)}
                    </td>
                    <td class="py-3 px-3 sm:px-4 text-xs sm:text-sm text-gray-700 whitespace-nowrap">
                        ${escapeHtml(user.email)}
                    </td>
                    <td class="py-3 px-3 sm:px-4 text-xs sm:text-sm font-medium text-gray-900 whitespace-nowrap">
                        ${escapeHtml(roleDisplay)}
                    </td>
                    <td class="py-3 px-3 sm:px-4 whitespace-nowrap">
                        <button 
                            type="button" 
                            class="${actionButtonClass}"
                            onclick="window.permissionsModule.openPermissionModal(${user.id})"
                        >
                            ${escapeHtml(actionButtonText)}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Open permission page - redirects to appropriate page
     */
    function openPermissionModal(userId) {
        const user = state.users.find(u => u.id === userId);
        if (!user) {
            window.notify.tryShow('User not found', 'error');
            return;
        }

        // Redirect based on whether user has permissions
        if (user.has_permissions) {
            // User has permissions - go to check/edit page
            window.location.href = `/system-admin/permissions/check/${userId}/`;
        } else {
            // User has no permissions - go to grant page
            window.location.href = `/system-admin/permissions/grant/${userId}/`;
        }
    }


    /**
     * Escape HTML
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose module functions
    window.permissionsModule = {
        openPermissionModal: openPermissionModal
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
