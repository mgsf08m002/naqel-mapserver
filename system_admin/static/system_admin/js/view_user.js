(function() {
    'use strict';

    const elements = {
        page: document.querySelector('.view-user'),
        loadingState: document.getElementById('loadingState'),
        userDetails: document.getElementById('userDetails'),
        errorState: document.getElementById('errorState'),
        errorMessage: document.getElementById('errorMessage'),
        avatarImage: document.getElementById('userAvatarImage'),
        avatarInitials: document.getElementById('userInitials'),
        userFullName: document.getElementById('userFullName'),
        userEmail: document.getElementById('userEmail'),
        userRole: document.getElementById('userRole'),
        userStatus: document.getElementById('userStatus'),
        detailFullName: document.getElementById('detailFullName'),
        detailEmail: document.getElementById('detailEmail'),
        detailUsername: document.getElementById('detailUsername'),
        detailRole: document.getElementById('detailRole'),
        detailStatus: document.getElementById('detailStatus'),
        detailSuperuser: document.getElementById('detailSuperuser'),
        detailCreationDate: document.getElementById('detailCreationDate'),
        detailCreationTime: document.getElementById('detailCreationTime')
    };

    function init() {
        loadUserDetails();
    }

    async function loadUserDetails() {
        try {
            elements.loadingState?.classList.remove('is-hidden');
            elements.userDetails?.classList.add('is-hidden');
            elements.errorState?.classList.add('is-hidden');

            const userId = elements.page?.dataset.userId;
            if (!userId || Number.isNaN(Number(userId))) {
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
            elements.userDetails?.classList.remove('is-hidden');
        } catch (error) {
            showError(error.message || 'Failed to load user information. Please try again.');
        } finally {
            elements.loadingState?.classList.add('is-hidden');
        }
    }

    function renderUserDetails(user) {
        const initials = getUserInitials(user);
        if (user.profile_image) {
            elements.avatarImage.src = user.profile_image;
            elements.avatarImage.classList.remove('is-hidden');
            elements.avatarInitials.classList.add('is-hidden');
        } else {
            elements.avatarImage.classList.add('is-hidden');
            elements.avatarInitials.classList.remove('is-hidden');
            elements.avatarInitials.textContent = initials;
        }

        const roleDisplay = roleLabel(user);
        elements.userFullName.textContent = user.full_name || user.email;
        elements.userEmail.textContent = user.email;
        elements.userRole.textContent = roleDisplay;
        setStatusChip(elements.userStatus, user.is_active);
        setStatusChip(elements.detailStatus, user.is_active);

        elements.detailFullName.textContent = user.full_name || 'Not set';
        elements.detailEmail.textContent = user.email || '—';
        elements.detailUsername.textContent = user.username || '—';
        elements.detailRole.textContent = roleDisplay;
        elements.detailSuperuser.textContent = user.is_superuser ? 'Yes' : 'No';
        elements.detailCreationDate.textContent = user.account_creation_date || 'Not set';
        elements.detailCreationTime.textContent = user.account_creation_time || 'Not set';
    }

    function setStatusChip(element, isActive) {
        if (!element) {
            return;
        }
        element.textContent = isActive ? 'Active' : 'Inactive';
        element.classList.toggle('is-active', isActive);
        element.classList.toggle('is-inactive', !isActive);
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

    function showError(message) {
        elements.errorState?.classList.remove('is-hidden');
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
