/**
 * Login Page JavaScript
 * Handles form submission and Google sign-in functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');

    function showNotification(message, type = 'info') {
        if (window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(message, type, undefined, {
                onUnavailable: function () {
                    showError(message);
                },
            });
        } else {
            showError(message);
        }
    }

    /**
     * Handle Enter key press to submit login form
     * This ensures Enter key works consistently when focus is on email or password fields
     */
    function handleEnterKeyPress(e) {
        // Only handle Enter key
        if (e.key !== 'Enter') {
            return;
        }

        // Only trigger if focus is on form elements
        const activeElement = document.activeElement;
        const isFormElement = loginForm && loginForm.contains(activeElement);
        
        if (isFormElement && loginForm) {
            // Prevent default form submission to use our custom handler
            e.preventDefault();
            
            // Trigger form submission by clicking submit button or calling submit
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
            }
        }
    }

    document.addEventListener('keydown', handleEnterKeyPress);

    // Handle form submission
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Hide previous error messages
            errorMessage.classList.add('hidden');
            
            // Get form data
            const formData = new FormData(loginForm);
            const email = formData.get('email');
            const password = formData.get('password');
            
            // Basic validation
            if (!email || !password) {
                showNotification('Please enter both email and password', 'error');
                return;
            }
            
            // Disable submit button
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing in...';
            
            try {
                // Get CSRF token
                const csrfTokenInput = document.querySelector('[name=csrfmiddlewaretoken]');
                if (!csrfTokenInput) {
                    showNotification('CSRF token not found. Please refresh the page.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                    return;
                }
                const csrfToken = csrfTokenInput.value;
                
                // Send login request
                const response = await fetch('/api/login/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify({
                        email: email,
                        password: password
                    })
                });
                
                // Parse response
                let data;
                try {
                    data = await response.json();
                } catch (parseError) {
                    // If response is not JSON, show generic error
                    showNotification('Invalid response from server. Please try again.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                    return;
                }
                
                if (data.success) {
                    // Show success notification
                    const successMessage = data.message || data.notification?.message || 'Login successful';
                    showNotification(successMessage, 'success');
                    
                    // Redirect on success - use redirect_url from API if provided
                    setTimeout(() => {
                        window.location.href = data.redirect_url || '/';
                    }, 500);
                } else {
                    // Show error notification
                    // Prioritize notification object if available, then message, then default
                    let errorMsg = 'Login failed. Please try again.';
                    let notificationType = 'error';
                    
                    // Extract message from notification object or message field
                    if (data.notification) {
                        if (data.notification.message) {
                            errorMsg = data.notification.message;
                        }
                        if (data.notification.type) {
                            notificationType = data.notification.type;
                        }
                    }
                    
                    // Fallback to message field if notification object doesn't have message
                    if (!data.notification || !data.notification.message) {
                        if (data.message) {
                            errorMsg = data.message;
                        }
                    }
                    
                    // Ensure error type for inactive accounts (403 status)
                    if (response.status === 403) {
                        notificationType = 'error';
                    }
                    
                    showNotification(errorMsg, notificationType);
                    
                    // Re-enable submit button on error
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
            } catch (error) {
                // Login error
                
                // Show generic error notification
                showNotification('An error occurred. Please try again.', 'error');
                
                // Re-enable submit button on error
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }


    /**
     * Display error message
     * @param {string} message - Error message to display
     */
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        
        // Scroll to error message
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});

