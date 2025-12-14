/**
 * Sidebar JavaScript
 * Handles sidebar navigation and mobile menu functionality
 */

(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        const sidebar = document.getElementById('sidebar');
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const navLinks = document.querySelectorAll('.nav-link');
        
        // Set active navigation link based on current URL
        function setActiveNavLink() {
            const currentPath = window.location.pathname;
            
            navLinks.forEach(link => {
                link.classList.remove('active');
                const href = link.getAttribute('href');
                
                if (href) {
                    // Check if current path matches the link's href
                    if (currentPath === href || currentPath.startsWith(href + '/')) {
                        link.classList.add('active');
                    }
                }
            });
            
            // Special case for dashboard - if we're on dashboard page, ensure it's active
            if (currentPath.includes('/system-admin/dashboard') || currentPath.endsWith('/system-admin/')) {
                const dashboardLink = document.getElementById('nav-dashboard');
                if (dashboardLink) {
                    // Remove active from all links first
                    navLinks.forEach(link => link.classList.remove('active'));
                    dashboardLink.classList.add('active');
                }
            }
        }
        
        // Toggle mobile sidebar
        function toggleSidebar() {
            if (sidebar) {
                sidebar.classList.toggle('open');
            }
        }
        
        // Close sidebar when clicking outside (mobile)
        function closeSidebarOnOutsideClick(event) {
            if (window.innerWidth < 1024 && sidebar && sidebar.classList.contains('open')) {
                if (!sidebar.contains(event.target) && !mobileMenuBtn.contains(event.target)) {
                    sidebar.classList.remove('open');
                }
            }
        }
        
        // Initialize
        setActiveNavLink();
        
        // Event listeners
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', toggleSidebar);
        }
        
        // Close sidebar on outside click
        document.addEventListener('click', closeSidebarOnOutsideClick);
        
        // Handle window resize
        window.addEventListener('resize', function() {
            if (window.innerWidth >= 1024 && sidebar) {
                sidebar.classList.remove('open');
            }
        });
        
        // Handle navigation link clicks
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                // Close mobile sidebar when navigating
                if (window.innerWidth < 1024 && sidebar) {
                    sidebar.classList.remove('open');
                }
            });
        });
    });
})();

