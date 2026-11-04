from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import zoneinfo


class UserProfile(models.Model):
    """Extended user profile for system admin."""
    ROLE_CHOICES = [
        ('manager', 'Manager'),
        ('editor', 'Editor'),
    ]
    
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    profile_image = models.ImageField(upload_to='profile_images/', blank=True, null=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, blank=True, null=True)
    password_setup_completed = models.BooleanField(default=False)
    account_creation_date = models.DateField(blank=True, null=True)
    account_creation_time = models.TimeField(blank=True, null=True)
    # Manager permissions
    can_access_dashboard = models.BooleanField(default=False)
    can_access_security = models.BooleanField(default=False)
    can_access_account_information = models.BooleanField(default=False)
    can_access_layer_uploader = models.BooleanField(default=False)
    can_access_my_edits = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s Profile"
    
    @staticmethod
    def get_riyadh_datetime():
        """Get current datetime in Riyadh timezone."""
        riyadh_tz = zoneinfo.ZoneInfo('Asia/Riyadh')
        return timezone.now().astimezone(riyadh_tz)
    
    def set_account_creation_datetime(self):
        """Set account creation date and time in Riyadh timezone."""
        riyadh_now = self.get_riyadh_datetime()
        self.account_creation_date = riyadh_now.date()
        self.account_creation_time = riyadh_now.time()
        self.save()


class PasswordResetRequest(models.Model):
    """User-initiated forgot-password request awaiting System Admin action."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="password_reset_requests",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="password_resets_handled",
    )
    admin_note = models.TextField(blank=True, default="")
    requester_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-requested_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(status="pending"),
                name="password_reset_one_pending_per_user",
            ),
        ]

    def __str__(self):
        return f"{self.user.username} — {self.status} ({self.requested_at:%Y-%m-%d})"


class PasswordChangeEvent(models.Model):
    """Audit row for admin/self password changes (powers Manage Passwords stats)."""

    class Source(models.TextChoices):
        ADMIN_DIRECT = "admin_direct", "Admin direct change"
        FORGOT_REQUEST = "forgot_request", "Forgot password request"
        SELF_SECURITY = "self_security", "Self service (Security)"

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="password_change_events",
    )
    changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="password_changes_performed",
    )
    source = models.CharField(max_length=32, choices=Source.choices)
    request = models.ForeignKey(
        PasswordResetRequest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="change_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} via {self.source} ({self.created_at:%Y-%m-%d})"
