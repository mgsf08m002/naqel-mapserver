/**
 * Home Page JavaScript
 * Handles user menu dropdown functionality for Editor
 */

(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        const userMenuBtn = document.getElementById('userMenuBtn');
        const userMenu = document.getElementById('userMenu');
        const userMenuIcon = document.getElementById('userMenuIcon');
        
        if (!userMenuBtn || !userMenu) return;

        /**
         * Set active menu item based on current URL
         */
        function setActiveMenuItem() {
            const currentPath = window.location.pathname;
            const menuItems = document.querySelectorAll('.menu-item');
            
            menuItems.forEach(function(item) {
                item.classList.remove('active', 'bg-gray-100', 'text-geotrak', 'font-medium');
                item.classList.add('text-gray-700');
                
                const href = item.getAttribute('href');
                if (href) {
                    // Normalize paths for comparison
                    const normalizedHref = href.replace(/\/$/, '');
                    const normalizedPath = currentPath.replace(/\/$/, '');
                    
                    // Check if current path matches or starts with the href
                    if (normalizedPath === normalizedHref || normalizedPath.startsWith(normalizedHref + '/')) {
                        item.classList.add('active', 'bg-gray-100', 'text-geotrak', 'font-medium');
                        item.classList.remove('text-gray-700');
                    }
                }
            });
        }

        /**
         * Toggle user menu
         */
        function toggleUserMenu() {
            const isHidden = userMenu.classList.contains('hidden');
            userMenu.classList.toggle('hidden');
            
            // Rotate icon when menu is open
            if (userMenuIcon) {
                if (isHidden) {
                    userMenuIcon.classList.add('rotate-180');
                } else {
                    userMenuIcon.classList.remove('rotate-180');
                }
            }
            
            // Update active state when menu opens
            if (isHidden) {
                setActiveMenuItem();
            }
        }
        
        /**
         * Close user menu when clicking outside
         */
        function closeUserMenuOnOutsideClick(event) {
            if (!userMenu.classList.contains('hidden')) {
                if (!userMenu.contains(event.target) && !userMenuBtn.contains(event.target)) {
                    userMenu.classList.add('hidden');
                    if (userMenuIcon) {
                        userMenuIcon.classList.remove('rotate-180');
                    }
                }
            }
        }
        
        /**
         * Close menu on escape key
         */
        function handleEscapeKey(event) {
            if (event.key === 'Escape' && !userMenu.classList.contains('hidden')) {
                userMenu.classList.add('hidden');
                if (userMenuIcon) {
                    userMenuIcon.classList.remove('rotate-180');
                }
            }
        }
        
        // Event listeners
        userMenuBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleUserMenu();
        });
        
        // Close menu when clicking on menu links
        const menuLinks = userMenu.querySelectorAll('a');
        menuLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                // Don't close immediately - let the page navigate
                // The menu will close naturally on page load
                setTimeout(function() {
                    userMenu.classList.add('hidden');
                    if (userMenuIcon) {
                        userMenuIcon.classList.remove('rotate-180');
                    }
                }, 100);
            });
        });
        
        // Set active menu item on page load
        setActiveMenuItem();
        
        // Close menu on outside click
        document.addEventListener('click', closeUserMenuOnOutsideClick);
        
        // Close menu on escape key
        document.addEventListener('keydown', handleEscapeKey);
    });
})();
