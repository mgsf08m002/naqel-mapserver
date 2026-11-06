(function() {
    'use strict';

    function t(key, fallback) {
        return typeof window.uiT === 'function' ? window.uiT(key, fallback) : fallback;
    }

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
            const fallback = t('view_user_load_failed', "Couldn't load user information — try again");
            if (!userId || Number.isNaN(Number(userId))) {
                showError(fallback);
                return;
            }

            const response = await fetch(`/system-admin/api/users/${userId}/`);
            const data = await response.json().catch(function() { return null; });
            if (!response.ok || !data || !data.success || !data.user) {
                showError(fallback);
                return;
            }

            renderUserDetails(data.user);
            elements.userDetails?.classList.remove('is-hidden');
        } catch (error) {
            showError(t('view_user_load_failed', "Couldn't load user information — try again"));
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

        elements.detailFullName.textContent = user.full_name || t('not_set', 'Not set');
        elements.detailEmail.textContent = user.email || '—';
        elements.detailUsername.textContent = user.username || '—';
        elements.detailRole.textContent = roleDisplay;
        elements.detailSuperuser.textContent = user.is_superuser ? t('yes', 'Yes') : t('no', 'No');
        elements.detailCreationDate.textContent = user.account_creation_date || t('not_set', 'Not set');
        elements.detailCreationTime.textContent = user.account_creation_time || t('not_set', 'Not set');
    }

    function setStatusChip(element, isActive) {
        if (!element) {
            return;
        }
        element.textContent = isActive ? t('active', 'Active') : t('inactive', 'Inactive');
        element.classList.toggle('is-active', isActive);
        element.classList.toggle('is-inactive', !isActive);
    }

    function roleLabel(user) {
        if (user.is_superuser || user.role === 'system_admin') {
            return t('role_system_admin', 'System Admin');
        }
        if (user.role === 'manager') {
            return t('role_manager', 'Manager');
        }
        if (user.role === 'editor') {
            return t('role_editor', 'Editor');
        }
        if (user.role === 'viewer') {
            return t('role_viewer', 'Viewer');
        }
        return t('not_assigned', 'Not assigned');
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
