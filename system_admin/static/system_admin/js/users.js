(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const addUserBtn = document.getElementById('addUserBtn');
        const editUserBtn = document.getElementById('editUserBtn');
        const deleteUserBtn = document.getElementById('deleteUserBtn');
        const allUsersBtn = document.getElementById('allUsersBtn');

        /**
         * Handle Add User button click
         */
        if (addUserBtn) {
            addUserBtn.addEventListener('click', () => {
                window.location.href = '/system-admin/users/add/';
            });
        }

        /**
         * Handle Edit User button click
         */
        if (editUserBtn) {
            editUserBtn.addEventListener('click', () => {
                window.location.href = '/system-admin/users/edit/';
            });
        }

        /**
         * Handle Delete User button click
         */
        if (deleteUserBtn) {
            deleteUserBtn.addEventListener('click', () => {
                window.location.href = '/system-admin/users/delete/';
            });
        }

        /**
         * Handle All Users button click
         */
        if (allUsersBtn) {
            allUsersBtn.addEventListener('click', () => {
                window.location.href = '/system-admin/users/all/';
            });
        }
    });
})();

