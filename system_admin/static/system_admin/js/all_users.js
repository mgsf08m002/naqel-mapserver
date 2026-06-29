(function() {
    'use strict';

    // State management
    const state = {
        users: [],
        filteredUsers: [],
        currentView: 'classic',
        roleFilter: '',
        searchQuery: '',
        visibleColumns: {
            name: true,
            email: true,
            role: true,
            status: true,
            created: true,
            last_login: true
        }
    };

    // DOM Elements
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
        roleFilter: document.getElementById('roleFilter'),
        searchInput: document.getElementById('searchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        columnCustomizeBtn: document.getElementById('columnCustomizeBtn'),
        columnCustomizeMenu: document.getElementById('columnCustomizeMenu'),
        columnToggles: document.querySelectorAll('.column-toggle'),
        resultsCounter: document.getElementById('resultsCounter'),
        resultsCount: document.getElementById('resultsCount')
    };

    /**
     * Initialize the page
     */
    function init() {
        setupEventListeners();
        loadSavedPreferences();
        loadUsers();
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // View switcher
        elements.viewClassic?.addEventListener('click', () => switchView('classic'));
        elements.viewList?.addEventListener('click', () => switchView('list'));
        elements.viewTable?.addEventListener('click', () => switchView('table'));

        // Search input
        let searchTimeout;
        elements.searchInput?.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            state.searchQuery = e.target.value.trim().toLowerCase();
            
            // Show/hide clear button
            if (state.searchQuery) {
                elements.clearSearchBtn?.classList.remove('hidden');
            } else {
                elements.clearSearchBtn?.classList.add('hidden');
            }
            
            // Debounce search
            searchTimeout = setTimeout(() => {
                applyFilters();
                savePreferences();
            }, 300);
        });

        // Clear search
        elements.clearSearchBtn?.addEventListener('click', () => {
            state.searchQuery = '';
            elements.searchInput.value = '';
            elements.clearSearchBtn?.classList.add('hidden');
            applyFilters();
            savePreferences();
        });

        // Role filter
        elements.roleFilter?.addEventListener('change', (e) => {
            state.roleFilter = e.target.value;
            applyFilters();
            savePreferences();
        });

        // Column customization
        elements.columnCustomizeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.columnCustomizeMenu?.classList.toggle('hidden');
        });

        // Close column menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!elements.columnCustomizeBtn?.contains(e.target) && 
                !elements.columnCustomizeMenu?.contains(e.target)) {
                elements.columnCustomizeMenu?.classList.add('hidden');
            }
        });

        // Column toggles
        elements.columnToggles?.forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const column = e.target.dataset.column;
                state.visibleColumns[column] = e.target.checked;
                applyFilters();
                savePreferences();
            });
        });
    }

    /**
     * Load users from API
     */
    async function loadUsers() {
        try {
            elements.loadingState?.classList.remove('hidden');
            elements.emptyState?.classList.add('hidden');

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
            elements.loadingState?.classList.add('hidden');
        }
    }

    /**
     * Apply filters and render
     */
    function applyFilters() {
        // Filter by role
        let filtered = state.users.filter(user => {
            if (state.roleFilter && state.roleFilter !== '') {
                if (state.roleFilter === 'system_admin') {
                    return user.is_superuser;
                }
                return user.role === state.roleFilter;
            }
            return true;
        });

        // Filter by search query
        if (state.searchQuery) {
            filtered = filtered.filter(user => {
                const searchLower = state.searchQuery.toLowerCase();
                const fullName = (user.full_name || '').toLowerCase();
                const email = (user.email || '').toLowerCase();
                const role = (user.role || '').toLowerCase();
                const roleDisplay = user.is_superuser ? 'system admin' : role;
                
                return fullName.includes(searchLower) || 
                       email.includes(searchLower) || 
                       roleDisplay.includes(searchLower);
            });
        }

        state.filteredUsers = filtered;
        
        // Update results counter
        updateResultsCounter();

        // Render based on current view
        renderUsers();
    }

    /**
     * Update results counter
     */
    function updateResultsCounter() {
        if (elements.resultsCount) {
            elements.resultsCount.textContent = state.filteredUsers.length;
        }
    }

    /**
     * Switch view mode
     * @param {string} view - The view to switch to ('classic', 'list', or 'table')
     * @param {boolean} save - Whether to save preferences (default: true)
     */
    function switchView(view, save = true) {
        state.currentView = view;
        
        // Update button states
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

        // Hide all views
        elements.classicView?.classList.add('hidden');
        elements.listView?.classList.add('hidden');
        elements.tableView?.classList.add('hidden');

        // Show selected view
        if (view === 'classic') {
            elements.classicView?.classList.remove('hidden');
        } else if (view === 'list') {
            elements.listView?.classList.remove('hidden');
        } else if (view === 'table') {
            elements.tableView?.classList.remove('hidden');
        }

        renderUsers();
        if (save) {
            savePreferences();
        }
    }

    /**
     * Render users based on current view
     */
    function renderUsers() {
        if (state.filteredUsers.length === 0) {
            elements.emptyState?.classList.remove('hidden');
            return;
        }

        elements.emptyState?.classList.add('hidden');

        if (state.currentView === 'classic') {
            renderClassicView();
        } else if (state.currentView === 'list') {
            renderListView();
        } else if (state.currentView === 'table') {
            renderTableView();
        }
    }

    /**
     * Render classic view (cards)
     */
    function renderClassicView() {
        const container = elements.classicView;
        if (!container) return;

        container.innerHTML = state.filteredUsers.map(user => {
            const initials = getUserInitials(user);
            const statusClass = user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
            const statusText = user.is_active ? 'Active' : 'Inactive';
            const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : (user.is_superuser ? 'System Admin' : 'Not assigned');

            return `
                <div class="bg-white border-2 border-gray-200 rounded-xl p-6 hover:shadow-xl hover:border-gray-300 transition-all duration-200 group">
                    <div class="flex items-start justify-between mb-5">
                        <div class="flex items-center gap-4 flex-1 min-w-0">
                            <div class="w-14 h-14 rounded-full bg-gradient-to-br from-geotrak to-geotrak-hover text-white flex items-center justify-center font-semibold text-base flex-shrink-0 overflow-hidden ring-2 ring-gray-100 group-hover:ring-gray-300 transition-all">
                                ${user.profile_image ? 
                                    `<img src="${user.profile_image}" alt="Profile" class="w-full h-full object-cover">` : 
                                    `<span>${initials}</span>`
                                }
                            </div>
                            <div class="flex-1 min-w-0">
                                <h3 class="text-base font-semibold text-geotrak truncate mb-1">${escapeHtml(user.full_name || user.email)}</h3>
                                <p class="text-xs text-gray-500 truncate">${escapeHtml(user.email)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="space-y-3 mb-5">
                        ${state.visibleColumns.role ? `
                            <div class="flex items-center justify-between py-1.5 px-2 rounded-lg bg-gray-50">
                                <span class="text-xs font-medium text-gray-600">Role</span>
                                <span class="text-xs font-semibold text-geotrak px-2 py-1 rounded-md bg-white">${escapeHtml(roleDisplay)}</span>
                            </div>
                        ` : ''}
                        ${state.visibleColumns.status ? `
                            <div class="flex items-center justify-between py-1.5 px-2 rounded-lg bg-gray-50">
                                <span class="text-xs font-medium text-gray-600">Status</span>
                                <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}">${statusText}</span>
                            </div>
                        ` : ''}
                        ${state.visibleColumns.created && user.account_creation_date ? `
                            <div class="flex items-center justify-between py-1.5 px-2 rounded-lg bg-gray-50">
                                <span class="text-xs font-medium text-gray-600">Created</span>
                                <span class="text-xs font-medium text-geotrak">${escapeHtml(user.account_creation_date)}</span>
                            </div>
                        ` : ''}
                        ${state.visibleColumns.last_login && user.last_login ? `
                            <div class="flex items-center justify-between py-1.5 px-2 rounded-lg bg-gray-50">
                                <span class="text-xs font-medium text-gray-600">Last Login</span>
                                <span class="text-xs font-medium text-geotrak">${escapeHtml(user.last_login)}</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="pt-4 border-t-2 border-gray-100">
                        <a href="/system-admin/users/view/${user.id}/" class="inline-flex items-center justify-center w-full rounded-full bg-geotrak px-4 py-2.5 text-xs font-semibold text-white hover:bg-geotrak-hover focus:outline-none focus:ring-2 focus:ring-geotrak focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow-md">
                            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                            </svg>
                            View Details
                        </a>
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
            const initials = getUserInitials(user);
            const statusClass = user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
            const statusText = user.is_active ? 'Active' : 'Inactive';
            const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : (user.is_superuser ? 'System Admin' : 'Not assigned');

            return `
                <div class="bg-white border-2 border-gray-200 rounded-xl p-5 hover:shadow-lg hover:border-gray-300 transition-all duration-200">
                    <div class="flex items-center gap-5">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-geotrak to-geotrak-hover text-white flex items-center justify-center font-semibold text-sm flex-shrink-0 overflow-hidden ring-2 ring-gray-100">
                            ${user.profile_image ? 
                                `<img src="${user.profile_image}" alt="Profile" class="w-full h-full object-cover">` : 
                                `<span>${initials}</span>`
                            }
                        </div>
                        <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-center">
                            ${state.visibleColumns.name ? `
                                <div class="min-w-0">
                                    <p class="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Name</p>
                                    <p class="text-sm font-semibold text-geotrak truncate">${escapeHtml(user.full_name || user.email)}</p>
                                </div>
                            ` : ''}
                            ${state.visibleColumns.email ? `
                                <div class="min-w-0">
                                    <p class="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Email</p>
                                    <p class="text-sm text-gray-700 truncate">${escapeHtml(user.email)}</p>
                                </div>
                            ` : ''}
                            ${state.visibleColumns.role ? `
                                <div class="min-w-0">
                                    <p class="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Role</p>
                                    <p class="text-sm font-semibold text-geotrak">${escapeHtml(roleDisplay)}</p>
                                </div>
                            ` : ''}
                            ${state.visibleColumns.status ? `
                                <div class="min-w-0">
                                    <p class="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Status</p>
                                    <span class="inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}">${statusText}</span>
                                </div>
                            ` : ''}
                            <div class="flex items-center justify-end sm:justify-start lg:justify-end">
                                <a href="/system-admin/users/view/${user.id}/" class="inline-flex items-center rounded-full bg-geotrak px-4 py-2 text-xs font-semibold text-white hover:bg-geotrak-hover focus:outline-none focus:ring-2 focus:ring-geotrak focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow-md">
                                    <svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                                    </svg>
                                    View
                                </a>
                            </div>
                        </div>
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
            const statusClass = user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
            const statusText = user.is_active ? 'Active' : 'Inactive';
            const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : (user.is_superuser ? 'System Admin' : 'Not assigned');

            return `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors duration-150">
                    ${state.visibleColumns.name ? `
                        <td class="column-name py-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold text-geotrak whitespace-nowrap">${escapeHtml(user.full_name || user.email)}</td>
                    ` : '<td class="column-name hidden"></td>'}
                    ${state.visibleColumns.email ? `
                        <td class="column-email py-3 px-3 sm:px-4 text-xs sm:text-sm text-gray-700 whitespace-nowrap">${escapeHtml(user.email)}</td>
                    ` : '<td class="column-email hidden"></td>'}
                    ${state.visibleColumns.role ? `
                        <td class="column-role py-3 px-3 sm:px-4 text-xs sm:text-sm font-medium text-geotrak whitespace-nowrap">${escapeHtml(roleDisplay)}</td>
                    ` : '<td class="column-role hidden"></td>'}
                    ${state.visibleColumns.status ? `
                        <td class="column-status py-3 px-3 sm:px-4 whitespace-nowrap">
                            <span class="inline-block text-[10px] sm:text-xs font-semibold px-2 sm:px-2.5 py-1 rounded-full ${statusClass}">${statusText}</span>
                        </td>
                    ` : '<td class="column-status hidden"></td>'}
                    ${state.visibleColumns.created ? `
                        <td class="column-created py-3 px-3 sm:px-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">${escapeHtml(user.account_creation_date || '-')}</td>
                    ` : '<td class="column-created hidden"></td>'}
                    ${state.visibleColumns.last_login ? `
                        <td class="column-last_login py-3 px-3 sm:px-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">${escapeHtml(user.last_login || 'Never')}</td>
                    ` : '<td class="column-last_login hidden"></td>'}
                    <td class="py-3 px-3 sm:px-4 whitespace-nowrap">
                        <a href="/system-admin/users/view/${user.id}/" class="inline-flex items-center rounded-full bg-geotrak px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-semibold text-white hover:bg-geotrak-hover focus:outline-none focus:ring-2 focus:ring-geotrak focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow-md">
                            <svg class="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                            </svg>
                            <span class="hidden sm:inline">View</span>
                        </a>
                    </td>
                </tr>
            `;
        }).join('');

        // Update table header visibility
        document.querySelectorAll('thead th').forEach(th => {
            const column = th.classList.contains('column-name') ? 'name' :
                          th.classList.contains('column-email') ? 'email' :
                          th.classList.contains('column-role') ? 'role' :
                          th.classList.contains('column-status') ? 'status' :
                          th.classList.contains('column-created') ? 'created' :
                          th.classList.contains('column-last_login') ? 'last_login' : null;
            
            if (column && !state.visibleColumns[column]) {
                th.classList.add('hidden');
            } else if (column) {
                th.classList.remove('hidden');
            }
        });
    }

    /**
     * Get user initials
     */
    function getUserInitials(user) {
        if (user.full_name) {
            const parts = user.full_name.trim().split(' ');
            if (parts.length >= 2) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            }
            return parts[0][0].toUpperCase();
        }
        return user.email[0].toUpperCase();
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Show error message
     */
    function showError(message) {
        elements.emptyState?.classList.remove('hidden');
        const emptyText = elements.emptyState?.querySelector('p');
        if (emptyText) {
            emptyText.textContent = message;
        }
    }


    /**
     * Load saved preferences from localStorage
     */
    function loadSavedPreferences() {
        try {
            const savedView = localStorage.getItem('allUsersView');
            if (savedView && ['classic', 'list', 'table'].includes(savedView)) {
                switchView(savedView, false); // Don't save preferences when loading them
            } else {
                // Default to classic view if no saved preference
                switchView('classic', false);
            }

            const savedFilter = localStorage.getItem('allUsersRoleFilter');
            if (savedFilter) {
                state.roleFilter = savedFilter;
                if (elements.roleFilter) {
                    elements.roleFilter.value = savedFilter;
                }
            }

            const savedSearch = localStorage.getItem('allUsersSearchQuery');
            if (savedSearch) {
                state.searchQuery = savedSearch;
                if (elements.searchInput) {
                    elements.searchInput.value = savedSearch;
                    if (savedSearch) {
                        elements.clearSearchBtn?.classList.remove('hidden');
                    }
                }
            }

            const savedColumns = localStorage.getItem('allUsersVisibleColumns');
            if (savedColumns) {
                state.visibleColumns = { ...state.visibleColumns, ...JSON.parse(savedColumns) };
                elements.columnToggles?.forEach(toggle => {
                    const column = toggle.dataset.column;
                    if (state.visibleColumns.hasOwnProperty(column)) {
                        toggle.checked = state.visibleColumns[column];
                    }
                });
            }
        } catch (e) {
            // Default to classic view on error
            switchView('classic', false);
        }
    }

    /**
     * Save preferences to localStorage
     */
    function savePreferences() {
        try {
            localStorage.setItem('allUsersView', state.currentView);
            localStorage.setItem('allUsersRoleFilter', state.roleFilter);
            localStorage.setItem('allUsersSearchQuery', state.searchQuery);
            localStorage.setItem('allUsersVisibleColumns', JSON.stringify(state.visibleColumns));
        } catch (e) {
            // Failed to save preferences
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', init);
})();

