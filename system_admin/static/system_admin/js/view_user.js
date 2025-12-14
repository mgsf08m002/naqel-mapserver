(function() {
    'use strict';

    // DOM Elements
    const elements = {
        loadingState: document.getElementById('loadingState'),
        userDetails: document.getElementById('userDetails'),
        errorState: document.getElementById('errorState'),
        errorMessage: document.getElementById('errorMessage')
    };

    /**
     * Initialize the page
     */
    function init() {
        loadUserDetails();
    }

    /**
     * Load user details from API
     */
    async function loadUserDetails() {
        try {
            elements.loadingState?.classList.remove('hidden');
            elements.userDetails?.classList.add('hidden');
            elements.errorState?.classList.add('hidden');

            // Get user ID from URL
            const pathParts = window.location.pathname.split('/');
            const userId = pathParts[pathParts.length - 2]; // /view/{id}/

            if (!userId || userId === 'view') {
                throw new Error('Invalid user ID');
            }

            const response = await fetch(`/system-admin/api/users/${userId}/`);
            if (!response.ok) {
                throw new Error('Failed to load user details');
            }

            const data = await response.json();
            if (!data.success || !data.user) {
                throw new Error(data.message || 'User not found');
            }

            renderUserDetails(data.user);
        } catch (error) {
            console.error('Error loading user details:', error);
            showError(error.message || 'Failed to load user information. Please try again.');
        } finally {
            elements.loadingState?.classList.add('hidden');
        }
    }

    /**
     * Render user details
     */
    function renderUserDetails(user) {
        // Profile section
        const initials = getUserInitials(user);
        const avatarImage = document.getElementById('userAvatarImage');
        const avatarInitials = document.getElementById('userInitials');
        
        if (user.profile_image) {
            avatarImage.src = user.profile_image;
            avatarImage.classList.remove('hidden');
            avatarInitials.classList.add('hidden');
        } else {
            avatarImage.classList.add('hidden');
            avatarInitials.classList.remove('hidden');
            avatarInitials.textContent = initials;
        }

        document.getElementById('userFullName').textContent = user.full_name || user.email;
        document.getElementById('userEmail').textContent = user.email;

        // Role badge
        const roleDisplay = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : (user.is_superuser ? 'System Admin' : 'Not assigned');
        document.getElementById('userRole').textContent = roleDisplay;

        // Status badge
        const statusEl = document.getElementById('userStatus');
        if (user.is_active) {
            statusEl.textContent = 'Active';
            statusEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800';
        } else {
            statusEl.textContent = 'Inactive';
            statusEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800';
        }

        // Account Information
        document.getElementById('detailFullName').textContent = user.full_name || 'Not set';
        document.getElementById('detailEmail').textContent = user.email || '-';
        document.getElementById('detailUsername').textContent = user.username || '-';
        document.getElementById('detailRole').textContent = roleDisplay;
        
        const detailStatus = document.getElementById('detailStatus');
        if (user.is_active) {
            detailStatus.textContent = 'Active';
            detailStatus.className = 'text-sm font-medium text-green-600';
        } else {
            detailStatus.textContent = 'Inactive';
            detailStatus.className = 'text-sm font-medium text-red-600';
        }

        document.getElementById('detailSuperuser').textContent = user.is_superuser ? 'Yes' : 'No';

        // Account Dates
        document.getElementById('detailCreationDate').textContent = user.account_creation_date || 'Not set';
        document.getElementById('detailCreationTime').textContent = user.account_creation_time || 'Not set';

        // Show user details
        elements.userDetails?.classList.remove('hidden');
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
        if (user.first_name && user.last_name) {
            return (user.first_name[0] + user.last_name[0]).toUpperCase();
        }
        if (user.first_name) {
            return user.first_name[0].toUpperCase();
        }
        return user.email ? user.email[0].toUpperCase() : 'U';
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
     * Show error state
     */
    function showError(message) {
        elements.errorState?.classList.remove('hidden');
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', init);
})();

