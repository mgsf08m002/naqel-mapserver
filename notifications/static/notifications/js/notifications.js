/**
 * Centralized Notification System
 * Clean, high-quality notification system for the application
 */

(function() {
    'use strict';

    class NotificationSystem {
        constructor() {
            this.container = null;
            this.template = null;
            this.notifications = [];
            this.autoHideDelay = 7000; // 7 seconds
            this.init();
        }

        /**
         * Initialize the notification system
         */
        init() {
            document.addEventListener('DOMContentLoaded', () => {
                this.container = document.getElementById('notificationContainer');
                this.template = document.getElementById('notificationTemplate');
                
                if (!this.container || !this.template) {
                    console.error('Notification container or template not found');
                    return;
                }

                // Make it globally available
                window.notify = this;
            });
        }

        /**
         * Show a notification
         * @param {string} message - Notification message
         * @param {string} type - Notification type (success, error, warning, info)
         * @param {number} duration - Auto-hide duration in milliseconds (0 = no auto-hide)
         * @returns {string} Notification ID
         */
        show(message, type = 'info', duration = this.autoHideDelay) {
            if (!this.container || !this.template) {
                // Retry initialization
                this.init();
                if (!this.container || !this.template) {
                    console.error('Notification system not initialized');
                    return null;
                }
            }

            const notificationId = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const notification = this.createNotification(notificationId, message, type);
            
            this.container.appendChild(notification);
            this.notifications.push(notificationId);

            // Animate in
            requestAnimationFrame(() => {
                setTimeout(() => {
                    notification.classList.add('show');
                }, 10);
            });

            // Auto-hide if duration is set
            if (duration > 0) {
                setTimeout(() => {
                    this.hide(notificationId);
                }, duration);
            }

            return notificationId;
        }

        /**
         * Create notification element
         * @param {string} id - Notification ID
         * @param {string} message - Notification message
         * @param {string} type - Notification type
         * @returns {HTMLElement} Notification element
         */
        createNotification(id, message, type) {
            const clone = this.template.content.cloneNode(true);
            const notification = clone.querySelector('.notification-item');
            const messageEl = clone.querySelector('.notification-message');
            const iconEl = clone.querySelector('.notification-icon');
            const closeBtn = clone.querySelector('.notification-close');

            notification.id = id;
            notification.setAttribute('data-type', type);
            
            // Decode HTML entities and clean up the message
            const decodedMessage = this.decodeHtmlEntities(message);
            messageEl.textContent = decodedMessage;

            // Set icon based on type
            const iconSvg = this.getIconForType(type);
            iconEl.innerHTML = iconSvg;

            // Set border color based on type
            this.setBorderColor(notification, type);

            // Close button handler
            closeBtn.addEventListener('click', () => {
                this.hide(id);
            });

            return notification;
        }

        /**
         * Get icon SVG for notification type
         * @param {string} type - Notification type
         * @returns {string} SVG HTML
         */
        getIconForType(type) {
            const icons = {
                success: '<svg class="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
                error: '<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
                warning: '<svg class="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
                info: '<svg class="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
            };
            return icons[type] || icons.info;
        }

        /**
         * Decode HTML entities and JavaScript escape sequences
         * @param {string} text - Text to decode
         * @returns {string} Decoded text
         */
        decodeHtmlEntities(text) {
            if (!text) return '';
            
            let decoded = String(text);
            
            // First decode JavaScript Unicode escape sequences like \u0022 (must be done before HTML entity decoding)
            decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => {
                return String.fromCharCode(parseInt(code, 16));
            });
            
            // Decode common HTML entities
            decoded = decoded
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&#x27;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
            
            // Use textarea to decode any remaining HTML entities (handles numeric entities like &#34;)
            const textarea = document.createElement('textarea');
            textarea.innerHTML = decoded;
            decoded = textarea.value;
            
            return decoded;
        }

        /**
         * Set border color based on type
         * @param {HTMLElement} notification - Notification element
         * @param {string} type - Notification type
         */
        setBorderColor(notification, type) {
            // Remove existing border color classes
            notification.classList.remove('border-green-500', 'border-red-500', 'border-yellow-500');
            
            if (type === 'success') {
                notification.classList.add('border-green-500');
            } else if (type === 'error') {
                notification.classList.add('border-red-500');
            } else if (type === 'warning') {
                notification.classList.add('border-yellow-500');
            }
        }

        /**
         * Hide a notification
         * @param {string} notificationId - Notification ID
         */
        hide(notificationId) {
            const notification = document.getElementById(notificationId);
            if (notification) {
                notification.classList.add('hide');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                    this.notifications = this.notifications.filter(id => id !== notificationId);
                }, 300);
            }
        }

        /**
         * Hide all notifications
         */
        hideAll() {
            this.notifications.forEach(id => this.hide(id));
        }

        /**
         * Show success notification
         * @param {string} message - Notification message
         * @param {number} duration - Auto-hide duration
         * @returns {string} Notification ID
         */
        success(message, duration = this.autoHideDelay) {
            return this.show(message, 'success', duration);
        }

        /**
         * Show error notification
         * @param {string} message - Notification message
         * @param {number} duration - Auto-hide duration
         * @returns {string} Notification ID
         */
        error(message, duration = this.autoHideDelay) {
            return this.show(message, 'error', duration);
        }

        /**
         * Show warning notification
         * @param {string} message - Notification message
         * @param {number} duration - Auto-hide duration
         * @returns {string} Notification ID
         */
        warning(message, duration = this.autoHideDelay) {
            return this.show(message, 'warning', duration);
        }

        /**
         * Show info notification
         * @param {string} message - Notification message
         * @param {number} duration - Auto-hide duration
         * @returns {string} Notification ID
         */
        info(message, duration = this.autoHideDelay) {
            return this.show(message, 'info', duration);
        }
    }

    // Initialize notification system
    const notificationSystem = new NotificationSystem();
    
    // Make it globally available immediately
    window.notify = notificationSystem;

})();

