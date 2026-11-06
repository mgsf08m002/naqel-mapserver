/**
 * System Admin registration — multi-step setup flow.
 */

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('registrationForm');
    const errorMessage = document.getElementById('errorMessage');
    const stepTitle = document.getElementById('stepTitle');
    const stepDescription = document.getElementById('stepDescription');
    const nextButton = document.getElementById('nextButton');
    const prevButton = document.getElementById('prevButton');
    const submitButton = document.getElementById('submitButton');
    const navigationButtons = document.getElementById('navigationButtons');
    const getStartedButton = document.getElementById('getStartedButton');

    let currentStep = 0;
    const totalSteps = 5;
    let formData = {};
    let redirectCountdown = 5;

    function t(key, vars) {
        const table = window.UI_I18N || {};
        let text = table[key] || key;
        if (vars) {
            Object.keys(vars).forEach(function (name) {
                text = text.replace('{' + name + '}', vars[name]);
            });
        }
        return text;
    }

    const steps = {
        0: {
            title: t('onetime_welcome'),
            description: t('onetime_welcome_sub'),
        },
        1: {
            title: t('step_full_name_title'),
            description: t('step_full_name_desc'),
            field: 'fullName',
            validate: function () {
                const value = document.getElementById('fullName').value.trim();
                if (!value) {
                    showError(t('full_name_required'));
                    return false;
                }
                if (value.length < 2) {
                    showError(t('full_name_min'));
                    return false;
                }
                return true;
            },
        },
        2: {
            title: t('step_email_title'),
            description: t('step_email_desc'),
            field: 'email',
            validate: function () {
                const value = document.getElementById('email').value.trim();
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!value) {
                    showError(t('email_address_required'));
                    return false;
                }
                if (!emailRegex.test(value)) {
                    showError(t('email_invalid'));
                    return false;
                }
                return true;
            },
        },
        3: {
            title: t('step_password_title'),
            description: t('step_password_desc'),
            field: 'password',
            validate: function () {
                const value = document.getElementById('password').value;
                if (!value) {
                    showError(t('password_required'));
                    return false;
                }
                if (value.length < 8) {
                    showError(t('password_min'));
                    return false;
                }
                return true;
            },
        },
        4: {
            title: t('step_confirm_title'),
            description: t('step_confirm_desc'),
            field: 'confirmPassword',
            validate: function () {
                const password = document.getElementById('password').value;
                const confirmPassword = document.getElementById('confirmPassword').value;
                if (!confirmPassword) {
                    showError(t('confirm_password_required'));
                    return false;
                }
                if (password !== confirmPassword) {
                    showError(t('passwords_mismatch'));
                    return false;
                }
                return true;
            },
        },
    };

    if (getStartedButton) {
        getStartedButton.addEventListener('click', function () {
            currentStep = 1;
            showStep(1);
        });
    }

    if (nextButton) {
        nextButton.addEventListener('click', function () {
            if (validateCurrentStep()) {
                saveCurrentStepData();
                if (currentStep < totalSteps - 1) {
                    currentStep++;
                    showStep(currentStep);
                }
            }
        });
    }

    if (prevButton) {
        prevButton.addEventListener('click', function () {
            if (currentStep > 1) {
                currentStep--;
                showStep(currentStep);
            }
        });
    }

    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (currentStep === 4 && validateCurrentStep()) {
                saveCurrentStepData();
                await submitRegistration();
            }
        });
    }

    function handleEnterKeyPress(e) {
        if (e.key !== 'Enter') {
            return;
        }
        e.preventDefault();

        switch (currentStep) {
            case 0:
                if (getStartedButton && !getStartedButton.disabled) {
                    getStartedButton.click();
                }
                break;
            case 1:
            case 2:
            case 3:
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                }
                break;
            case 4:
                if (submitButton && !submitButton.disabled) {
                    submitButton.click();
                }
                break;
            default:
                break;
        }
    }

    document.addEventListener('keydown', function (e) {
        const activeElement = document.activeElement;
        const isFormElement = form && form.contains(activeElement);
        const isGetStartedButton = activeElement === getStartedButton;
        if (isFormElement || isGetStartedButton || currentStep === 0) {
            handleEnterKeyPress(e);
        }
    });

    function showStep(step) {
        for (let i = 0; i <= totalSteps; i++) {
            const stepElement = document.getElementById('step' + i);
            if (stepElement) {
                stepElement.classList.add('hidden');
            }
        }

        const currentStepElement = document.getElementById('step' + step);
        if (currentStepElement) {
            currentStepElement.classList.remove('hidden');
        }

        if (step < 5 && steps[step]) {
            stepTitle.textContent = steps[step].title;
            stepDescription.textContent = steps[step].description;
        } else {
            stepTitle.textContent = t('registration_complete');
            stepDescription.textContent = t('registration_ready');
        }

        if (step === 0 || step === 5) {
            navigationButtons.classList.add('hidden');
            navigationButtons.setAttribute('aria-hidden', 'true');
            prevButton.classList.add('hidden');
            nextButton.classList.add('hidden');
            submitButton.classList.add('hidden');
            if (step === 5) {
                startRedirectCountdown();
            }
        } else if (step === 1) {
            // Full name: Next only
            prevButton.classList.add('hidden');
            nextButton.classList.remove('hidden');
            submitButton.classList.add('hidden');
            navigationButtons.classList.remove('hidden');
            navigationButtons.setAttribute('aria-hidden', 'false');
        } else if (step === 4) {
            // Confirm password: Previous + Create Account
            prevButton.classList.remove('hidden');
            nextButton.classList.add('hidden');
            submitButton.classList.remove('hidden');
            navigationButtons.classList.remove('hidden');
            navigationButtons.setAttribute('aria-hidden', 'false');
        } else {
            // Email / password: Previous + Next
            prevButton.classList.remove('hidden');
            nextButton.classList.remove('hidden');
            submitButton.classList.add('hidden');
            navigationButtons.classList.remove('hidden');
            navigationButtons.setAttribute('aria-hidden', 'false');
        }

        if (step > 0 && step < 5 && steps[step] && steps[step].field) {
            const field = document.getElementById(steps[step].field);
            if (field) {
                setTimeout(function () {
                    field.focus();
                }, 100);
            }
        }

        clearError();
    }

    function validateCurrentStep() {
        if (steps[currentStep] && steps[currentStep].validate) {
            return steps[currentStep].validate();
        }
        return true;
    }

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

    async function submitRegistration() {
        clearError();

        const submitBtn = submitButton;
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = t('creating_account');

        try {
            const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
            const response = await fetch('/api/onetime/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken,
                },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (data.success) {
                toastOrFormError(data.message || t('admin_created'), 'success');
                currentStep = 5;
                showStep(5);
            } else {
                toastOrFormError(
                    data.message || t('registration_failed'),
                    'error'
                );
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        } catch (error) {
            showError(t('generic_error'));
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }

    function startRedirectCountdown() {
        const redirectMessage = document.getElementById('redirectMessage');
        if (redirectMessage) {
            redirectMessage.textContent = t('redirect_login', {
                seconds: redirectCountdown,
            });
        }

        const countdownInterval = setInterval(function () {
            redirectCountdown--;
            if (redirectMessage) {
                redirectMessage.textContent = t('redirect_login', {
                    seconds: redirectCountdown,
                });
            }
            if (redirectCountdown <= 0) {
                clearInterval(countdownInterval);
                window.location.href = '/login/';
            }
        }, 1000);
    }

    function safeMsg(message, fallback) {
        if (typeof window.safeUserMessage === 'function') {
            return window.safeUserMessage(message, fallback || t('generic_error'));
        }
        return message || fallback || t('generic_error');
    }

    function toastOrFormError(message, type) {
        var text = safeMsg(message, t('generic_error'));
        if (window.notify && typeof window.notify.tryShow === 'function') {
            window.notify.tryShow(text, type, undefined, {
                onUnavailable: function () {
                    showError(text);
                },
            });
        } else {
            showError(text);
        }
    }

    function clearError() {
        if (!errorMessage) return;
        errorMessage.textContent = '';
        errorMessage.classList.remove('is-visible');
    }

    function showError(message) {
        if (!errorMessage) return;
        errorMessage.textContent = safeMsg(message, t('generic_error'));
        errorMessage.classList.add('is-visible');
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    showStep(0);
});
