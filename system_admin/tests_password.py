"""Tests for forgot-password requests and admin password reset flows."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from system_admin.models import PasswordChangeEvent, PasswordResetRequest, UserProfile
from system_admin.password_admin import (
    REQUEST_COOLDOWN,
    apply_admin_temporary_password,
    create_password_reset_request,
    dismiss_password_reset_request,
)


User = get_user_model()


class PasswordResetHelpersTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username="admin@example.com",
            email="admin@example.com",
            password="adminpass123",
        )
        self.editor = User.objects.create_user(
            username="editor@example.com",
            email="editor@example.com",
            password="oldpass123",
        )
        UserProfile.objects.create(
            user=self.editor,
            role="editor",
            password_setup_completed=True,
        )
        self.inactive = User.objects.create_user(
            username="inactive@example.com",
            email="inactive@example.com",
            password="oldpass123",
            is_active=False,
        )
        UserProfile.objects.create(
            user=self.inactive,
            role="editor",
            password_setup_completed=True,
        )

    def test_create_request_for_eligible_user(self):
        req, err = create_password_reset_request(user=self.editor)
        self.assertEqual(err, "")
        self.assertIsNotNone(req)
        self.assertEqual(req.status, PasswordResetRequest.Status.PENDING)

    def test_second_pending_request_rejected(self):
        create_password_reset_request(user=self.editor)
        req, err = create_password_reset_request(user=self.editor)
        self.assertIsNone(req)
        self.assertEqual(err, "pending")

    def test_inactive_user_blocked(self):
        req, err = create_password_reset_request(user=self.inactive)
        self.assertIsNone(req)
        self.assertEqual(err, "inactive")

    def test_superuser_blocked(self):
        req, err = create_password_reset_request(user=self.admin)
        self.assertIsNone(req)
        self.assertEqual(err, "not_eligible")

    def test_cooldown_after_resolve(self):
        req, _ = create_password_reset_request(user=self.editor)
        apply_admin_temporary_password(
            target=self.editor,
            new_password="tempPass99",
            changed_by=self.admin,
            source=PasswordChangeEvent.Source.FORGOT_REQUEST,
            request=req,
        )
        again, err = create_password_reset_request(user=self.editor)
        self.assertIsNone(again)
        self.assertEqual(err, "cooldown")

    def test_cooldown_after_dismiss(self):
        req, _ = create_password_reset_request(user=self.editor)
        dismiss_password_reset_request(request=req, dismissed_by=self.admin)
        again, err = create_password_reset_request(user=self.editor)
        self.assertIsNone(again)
        self.assertEqual(err, "cooldown")

    def test_request_allowed_after_cooldown_expires(self):
        req, _ = create_password_reset_request(user=self.editor)
        dismiss_password_reset_request(request=req, dismissed_by=self.admin)
        PasswordResetRequest.objects.filter(pk=req.pk).update(
            resolved_at=timezone.now() - REQUEST_COOLDOWN - timedelta(minutes=1)
        )
        again, err = create_password_reset_request(user=self.editor)
        self.assertEqual(err, "")
        self.assertIsNotNone(again)

    def test_admin_direct_change_cancels_pending_and_forces_setup(self):
        create_password_reset_request(user=self.editor)
        apply_admin_temporary_password(
            target=self.editor,
            new_password="tempPass88",
            changed_by=self.admin,
            source=PasswordChangeEvent.Source.ADMIN_DIRECT,
        )
        self.editor.refresh_from_db()
        self.editor.profile.refresh_from_db()
        self.assertTrue(self.editor.check_password("tempPass88"))
        self.assertFalse(self.editor.profile.password_setup_completed)
        self.assertFalse(
            PasswordResetRequest.objects.filter(
                user=self.editor,
                status=PasswordResetRequest.Status.PENDING,
            ).exists()
        )
        self.assertEqual(
            PasswordChangeEvent.objects.filter(
                user=self.editor,
                source=PasswordChangeEvent.Source.ADMIN_DIRECT,
            ).count(),
            1,
        )


class ForgotPasswordViewTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.editor = User.objects.create_user(
            username="editor@example.com",
            email="editor@example.com",
            password="oldpass123",
        )
        UserProfile.objects.create(
            user=self.editor,
            role="editor",
            password_setup_completed=True,
        )

    def test_forgot_password_page_renders(self):
        response = self.client.get(reverse("auth:forgot_password"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Forgot password?")

    def test_unknown_email(self):
        response = self.client.post(
            reverse("auth:forgot_password"),
            {"email": "missing@example.com"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "No account found for that email.")

    def test_successful_request(self):
        response = self.client.post(
            reverse("auth:forgot_password"),
            {"email": "editor@example.com"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Request submitted")
        self.assertTrue(
            PasswordResetRequest.objects.filter(
                user=self.editor,
                status=PasswordResetRequest.Status.PENDING,
            ).exists()
        )

    def test_duplicate_pending_shows_error(self):
        create_password_reset_request(user=self.editor)
        response = self.client.post(
            reverse("auth:forgot_password"),
            {"email": "editor@example.com"},
        )
        self.assertContains(response, "already pending")


class AdminPasswordViewsTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.admin = User.objects.create_superuser(
            username="admin@example.com",
            email="admin@example.com",
            password="adminpass123",
        )
        self.editor = User.objects.create_user(
            username="editor@example.com",
            email="editor@example.com",
            password="oldpass123",
        )
        UserProfile.objects.create(
            user=self.editor,
            role="editor",
            password_setup_completed=True,
        )
        self.client.force_login(self.admin)

    def test_hub_shows_pending_count(self):
        create_password_reset_request(user=self.editor)
        response = self.client.get(reverse("system_admin:manage_passwords"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["pending_requests"], 1)

    def test_direct_change_password(self):
        create_password_reset_request(user=self.editor)
        search = self.client.post(
            reverse("system_admin:change_user_password"),
            {"intent": "search_user", "search_email": "editor@example.com"},
        )
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.context["user_to_change"], self.editor)

        result = self.client.post(
            reverse("system_admin:change_user_password"),
            {
                "intent": "set_password",
                "user_id": self.editor.pk,
                "new_password": "BrandNew99",
                "confirm_password": "BrandNew99",
            },
        )
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.context["password_set"])
        self.editor.refresh_from_db()
        self.editor.profile.refresh_from_db()
        self.assertTrue(self.editor.check_password("BrandNew99"))
        self.assertFalse(self.editor.profile.password_setup_completed)

    def test_resolve_request_from_queue(self):
        req, _ = create_password_reset_request(user=self.editor)
        response = self.client.post(
            reverse("system_admin:password_requests"),
            {
                "intent": "reset_password",
                "request_id": req.pk,
                "new_password": "QueuePass99",
                "confirm_password": "QueuePass99",
            },
        )
        self.assertEqual(response.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, PasswordResetRequest.Status.RESOLVED)
        self.editor.refresh_from_db()
        self.assertTrue(self.editor.check_password("QueuePass99"))
        self.assertEqual(
            PasswordChangeEvent.objects.filter(
                source=PasswordChangeEvent.Source.FORGOT_REQUEST
            ).count(),
            1,
        )

    def test_dismiss_request(self):
        req, _ = create_password_reset_request(user=self.editor)
        response = self.client.post(
            reverse("system_admin:password_requests"),
            {"intent": "dismiss_request", "request_id": req.pk},
        )
        self.assertEqual(response.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, PasswordResetRequest.Status.DISMISSED)

    def test_login_after_reset_redirects_to_password_setup(self):
        apply_admin_temporary_password(
            target=self.editor,
            new_password="TempLogin99",
            changed_by=self.admin,
            source=PasswordChangeEvent.Source.ADMIN_DIRECT,
        )
        self.client.logout()
        response = self.client.post(
            reverse("auth:login_api"),
            data='{"email":"editor@example.com","password":"TempLogin99"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("/password-setup/", payload["redirect_url"])
