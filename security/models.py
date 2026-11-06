from django.conf import settings
from django.db import models
from django.utils import timezone


class UserSession(models.Model):
    """
    First-class device/session record for the Security Active Sessions UI.

    Django's Session row remains the auth source of truth. This model stores
    enriched metadata (browser, OS, device, approximate location) keyed by
    session_key so the Security page can show professional session details.
    """

    class DeviceType(models.TextChoices):
        DESKTOP = "desktop", "Desktop"
        MOBILE = "mobile", "Mobile"
        TABLET = "tablet", "Tablet"
        UNKNOWN = "unknown", "Unknown"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="device_sessions",
    )
    session_key = models.CharField(max_length=40, unique=True, db_index=True)
    client_ip = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=512, blank=True, default="")
    browser = models.CharField(max_length=32, blank=True, default="other")
    os_name = models.CharField(max_length=64, blank=True, default="")
    device_type = models.CharField(
        max_length=16,
        choices=DeviceType.choices,
        default=DeviceType.UNKNOWN,
    )
    location_label = models.CharField(max_length=128, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    location_resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_seen_at"]
        indexes = [
            models.Index(fields=["user", "-last_seen_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.session_key[:8]} ({self.browser})"
