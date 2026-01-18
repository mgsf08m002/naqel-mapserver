/**
 * System Admin Registration JavaScript
 * Handles multi-step form flow and registration submission
 */

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registrationForm');
    const errorMessage = document.getElementById('errorMessage');
    const stepTitle = document.getElementById('stepTitle');
    const stepDescription = document.getElementById('stepDescription');
    const nextButton = document.getElementById('nextButton');
    const prevButton = document.getElementById('prevButton');
    const submitButton = document.getElementById('submitButton');
    const navigationButtons = document.getElementById('navigationButtons');
    
    let currentStep = 0;
    const totalSteps = 5;
    let formData = {};
    let redirectCountdown = 5;

    // Step configurations
    const steps = {
        0: {
            title: '',
            description: '',
            showNavigation: false
        },
        1: {
            title: 'Enter Full Name',
            description: 'Please enter your full name to continue.',
            field: 'fullName',
            validate: () => {
                const value = document.getElementById('fullName').value.trim();
                if (!value) {
                    showError('Full name is required');
                    return false;
                }
                if (value.length < 2) {
                    showError('Full name must be at least 2 characters');
                    return false;
                }
                return true;
            }
        },
        2: {
            title: 'Enter Email Address',
            description: 'Please enter your email address.',
            field: 'email',
            validate: () => {
                const value = document.getElementById('email').value.trim();
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!value) {
                    showError('Email address is required');
                    return false;
                }
                if (!emailRegex.test(value)) {
                    showError('Please enter a valid email address');
                    return false;
                }
                return true;
            }
        },
        3: {
            title: 'Enter Password',
            description: 'Please create a secure password.',
            field: 'password',
            validate: () => {
                const value = document.getElementById('password').value;
                if (!value) {
                    showError('Password is required');
                    return false;
                }
                if (value.length < 8) {
                    showError('Password must be at least 8 characters');
                    return false;
                }
                return true;
            }
        },
        4: {
            title: 'Confirm Password',
            description: 'Please confirm your password.',
            field: 'confirmPassword',
            validate: () => {
                const password = document.getElementById('password').value;
                const confirmPassword = document.getElementById('confirmPassword').value;
                if (!confirmPassword) {
                    showError('Please confirm your password');
                    return false;
                }
                if (password !== confirmPassword) {
                    showError('Passwords do not match');
                    return false;
                }
                return true;
            }
        }
    };

    // Get Started button handler
    const getStartedButton = document.getElementById('getStartedButton');
    if (getStartedButton) {
        getStartedButton.addEventListener('click', function() {
            currentStep = 1;
            showStep(1);
        });
    }

    // Next button handler
    if (nextButton) {
        nextButton.addEventListener('click', function() {
            if (validateCurrentStep()) {
                saveCurrentStepData();
                if (currentStep < totalSteps - 1) {
                    currentStep++;
                    showStep(currentStep);
                }
            }
        });
    }

    // Previous button handler
    if (prevButton) {
        prevButton.addEventListener('click', function() {
            if (currentStep > 1) {
                currentStep--;
                showStep(currentStep);
            }
        });
    }

    // Form submission handler
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (currentStep === 4 && validateCurrentStep()) {
                saveCurrentStepData();
                await submitRegistration();
            }
        });
    }

    /**
     * Handle Enter key press for form navigation
     * Step 0: Trigger "Get Started" button
     * Steps 1-3: Trigger "Next" button (with validation)
     * Step 4: Trigger "Create Account" submit button
     * Step 5: No action (thank you screen)
     */
    function handleEnterKeyPress(e) {
        // Only handle Enter key
        if (e.key !== 'Enter') {
            return;
        }

        // Prevent default form submission behavior
        e.preventDefault();

        // Handle based on current step
        switch (currentStep) {
            case 0:
                // Welcome screen: Trigger "Get Started" button
                if (getStartedButton && !getStartedButton.disabled) {
                    getStartedButton.click();
                }
                break;

            case 1:
            case 2:
            case 3:
                // Form input steps: Trigger "Next" button with validation
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                }
                break;

            case 4:
                // Final step: Trigger submit button
                if (submitButton && !submitButton.disabled) {
                    submitButton.click();
                }
                break;

            case 5:
                // Thank you screen: No action
                break;

            default:
                break;
        }
    }

    // Attach Enter key event listener to document level
    // This ensures Enter key works throughout the page, including input fields
    document.addEventListener('keydown', function(e) {
        // Only handle Enter key when it's relevant to the form
        // Check if focus is on a form element or button, or on step 0 (welcome screen)
        const activeElement = document.activeElement;
        const isFormElement = form && form.contains(activeElement);
        const isGetStartedButton = activeElement === getStartedButton;
        
        if (isFormElement || isGetStartedButton || currentStep === 0) {
            handleEnterKeyPress(e);
        }
    });

    /**
     * Show specific step
     */
    function showStep(step) {
        // Hide all steps
        for (let i = 0; i <= totalSteps; i++) {
            const stepElement = document.getElementById(`step${i}`);
            if (stepElement) {
                stepElement.classList.add('hidden');
            }
        }

        // Show current step with animation
        const currentStepElement = document.getElementById(`step${step}`);
        if (currentStepElement) {
            // Remove hidden class
            currentStepElement.classList.remove('hidden');
            // Reset animation by removing and re-adding
            const animatedContent = currentStepElement.querySelector('.animate-fade-in');
            if (animatedContent) {
                animatedContent.style.animation = 'none';
                setTimeout(() => {
                    animatedContent.style.animation = '';
                }, 10);
            }
        }

        // Update title and description
        if (step === 0) {
            stepTitle.textContent = '';
            stepDescription.textContent = '';
            navigationButtons.classList.add('hidden');
        } else if (step < 5) {
            stepTitle.textContent = steps[step].title;
            stepDescription.textContent = steps[step].description;
        } else {
            stepTitle.textContent = 'Registration Complete';
            stepDescription.textContent = '';
        }

        // Update navigation buttons
        if (step === 0) {
            navigationButtons.classList.add('hidden');
        } else if (step === 1) {
            prevButton.classList.add('hidden');
            nextButton.classList.remove('hidden');
            submitButton.classList.add('hidden');
            navigationButtons.classList.remove('hidden');
        } else if (step === 4) {
            prevButton.classList.remove('hidden');
            nextButton.classList.add('hidden');
            submitButton.classList.remove('hidden');
            navigationButtons.classList.remove('hidden');
        } else if (step === 5) {
            navigationButtons.classList.add('hidden');
            startRedirectCountdown();
        } else {
            prevButton.classList.remove('hidden');
            nextButton.classList.remove('hidden');
            submitButton.classList.add('hidden');
            navigationButtons.classList.remove('hidden');
        }

        // Focus on current field
        if (step > 0 && step < 5 && steps[step] && steps[step].field) {
            const field = document.getElementById(steps[step].field);
            if (field) {
                setTimeout(() => field.focus(), 100);
            }
        }

        // Hide error message
        errorMessage.classList.add('hidden');
    }

    /**
     * Validate current step
     */
    function validateCurrentStep() {
        if (steps[currentStep] && steps[currentStep].validate) {
            return steps[currentStep].validate();
        }
        return true;
    }

    /**
     * Save current step data
     */
    function saveCurrentStepData() {
        if (currentStep === 1) {
            formData.full_name = document.getElementById('fullName').value.trim();
        } else if (currentStep === 2) {
            formData.email = document.getElementById('email').value.trim();
        } else if (currentStep === 3) {
            formData.password = document.getElementById('password').value;
        } else if (currentStep === 4) {
            formData.confirm_password = document.getElementById('confirmPassword').value;
        }
    }

    /**
     * Submit registration
     */
    async function submitRegistration() {
        errorMessage.classList.add('hidden');
        
        const submitBtn = submitButton;
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Account...';
        
        try {
            const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
            
            const response = await fetch('/api/onetime/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Show success notification
                const successMsg = data.notification?.message || data.message || 'System Admin created successfully';
                showNotificationWithRetry(successMsg, 'success');
                // Move to thank you step
                currentStep = 5;
                showStep(5);
            } else {
                // Show error notification
                const errorMsg = data.notification?.message || data.message || 'Registration failed. Please try again.';
                showNotificationWithRetry(errorMsg, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        } catch (error) {
            // Registration error
            showError('An error occurred. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }

    /**
     * Start redirect countdown
     */
    function startRedirectCountdown() {
        const redirectMessage = document.getElementById('redirectMessage');
        const countdownInterval = setInterval(() => {
            redirectCountdown--;
            if (redirectMessage) {
                redirectMessage.textContent = `Redirecting to login page in ${redirectCountdown} seconds...`;
            }
            
            if (redirectCountdown <= 0) {
                clearInterval(countdownInterval);
                window.location.href = '/login/';
            }
        }, 1000);
    }

    /**
     * Helper function to show notification with retry logic
     */
    function showNotificationWithRetry(message, type = 'info') {
        function tryShowNotification(retries = 10) {
            if (window.notify && window.notify.show) {
                if (type === 'success') {
                    window.notify.success(message);
                } else if (type === 'error') {
                    window.notify.error(message);
                } else if (type === 'warning') {
                    window.notify.warning(message);
                } else {
                    window.notify.info(message);
                }
            } else if (retries > 0) {
                setTimeout(() => tryShowNotification(retries - 1), 50);
            } else {
                // Fallback to error message display if notification system not available
                showError(message);
            }
        }
        tryShowNotification();
    }

    /**
     * Display error message
     */
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Initialize welcome screen
    showStep(0);
});

