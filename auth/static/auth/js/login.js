/**
 * Login - email check first, then password sign-in.
 */

document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const passwordStep = document.getElementById('passwordStep');
    const continueBtn = document.getElementById('loginContinueBtn');

    let emailVerified = false;

    function t(key) {
        const table = window.UI_I18N || {};
        return table[key] || key;
    }

    showQueryParamNotices();

    function safeMsg(message, fallback) {
        if (typeof window.safeUserMessage === 'function') {
            return window.safeUserMessage(message, fallback || t('generic_error'));
        }
        return message || fallback || t('generic_error');
    }

    function showNotification(message, type = 'info') {
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

    function showError(message) {
        if (!errorMessage) return;
        errorMessage.textContent = safeMsg(message, t('generic_error'));
        errorMessage.classList.add('is-visible');
    }

    function clearError() {
        if (!errorMessage) return;
        errorMessage.textContent = '';
        errorMessage.classList.remove('is-visible');
    }

    function setBusy(btn, busy, busyLabel, idleLabel) {
        if (!btn) return;
        btn.disabled = !!busy;
        btn.textContent = busy ? busyLabel : idleLabel;
    }

    function resetToEmailStep() {
        emailVerified = false;
        if (passwordStep) passwordStep.hidden = true;
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.removeAttribute('required');
        }
        if (continueBtn) continueBtn.textContent = t('continue');
        if (emailInput) emailInput.readOnly = false;
        clearError();
    }

    function revealPasswordStep() {
        emailVerified = true;
        if (passwordStep) passwordStep.hidden = false;
        if (passwordInput) {
            passwordInput.setAttribute('required', 'required');
            passwordInput.focus();
        }
        if (emailInput) emailInput.readOnly = true;
        if (continueBtn) continueBtn.textContent = t('sign_in');
    }

    function getCsrfToken() {
        const input = document.querySelector('[name=csrfmiddlewaretoken]');
        return input ? input.value : '';
    }

    function showQueryParamNotices() {
        function run() {
            if (!window.notify) {
                setTimeout(run, 50);
                return;
            }

            const params = new URLSearchParams(window.location.search);
            if (params.get('email_changed') === '1') {
                window.notify.info(t('notice_email_changed'));
            }
            if (params.get('password_changed') === '1') {
                window.notify.info(t('notice_password_changed'));
            }
            if (params.get('no_permission') === '1') {
                const permissionType = params.get('permission_type');
                let message = t('notice_no_permission');
                if (permissionType === 'dashboard') {
                    message = t('notice_no_permission_dashboard');
                } else if (permissionType === 'account_information') {
                    message = t('notice_no_permission_account');
                } else if (permissionType === 'security') {
                    message = t('notice_no_permission_security');
                } else if (permissionType === 'layer_uploader') {
                    message = t('notice_no_permission_uploader');
                } else if (permissionType === 'my_edits') {
                    message = t('notice_no_permission_edits');
                }
                window.notify.error(message);
            }
            if (params.get('signed_out') === '1') {
                window.notify.info(t('notice_signed_out'));
            }
            if (params.get('session_ended') === '1') {
                window.notify.warning(t('notice_session_ended'));
            }
        }
        run();
    }

    if (emailInput) {
        emailInput.addEventListener('input', function () {
            if (emailVerified) {
                resetToEmailStep();
            }
        });
    }

    async function validateEmail(email) {
        const response = await fetch('/api/login/check-email/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({ email: email }),
        });

        let data = {};
        try {
            data = await response.json();
        } catch (err) {
            throw new Error(t('invalid_server_response'));
        }

        if (!data.success) {
            throw new Error(data.message || t('unable_verify_email'));
        }

        return data;
    }

    async function signIn(email, password) {
        const response = await fetch('/api/login/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({ email: email, password: password }),
        });

        let data = {};
        try {
            data = await response.json();
        } catch (err) {
            throw new Error(t('invalid_server_response'));
        }

        if (!data.success) {
            throw new Error(data.message || t('login_failed'));
        }

        return data;
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            clearError();

            const email = ((emailInput && emailInput.value) || '').trim();
            if (!email) {
                showNotification(t('enter_email'), 'error');
                return;
            }

            if (!emailVerified) {
                setBusy(continueBtn, true, t('checking'), t('continue'));
                try {
                    await validateEmail(email);
                    revealPasswordStep();
                } catch (err) {
                    showNotification(err.message || t('unable_verify_email'), 'error');
                } finally {
                    setBusy(continueBtn, false, t('checking'), t('continue'));
                }
                return;
            }

            const password = passwordInput ? passwordInput.value : '';
            if (!password) {
                showNotification(t('enter_password'), 'error');
                return;
            }

            setBusy(continueBtn, true, t('signing_in'), t('sign_in'));
            try {
                const data = await signIn(email, password);
                // Redirect is enough - no success toast flash.
                window.location.href = data.redirect_url || '/';
            } catch (err) {
                showNotification(err.message || t('login_failed'), 'error');
                setBusy(continueBtn, false, t('signing_in'), t('sign_in'));
            }
        });
    }
});
