"""
Tile access control for the shared Martin tile server.

Nginx guards /tiles/<source>/<z>/<x>/<y> with ``auth_request``. For each tile it
asks ``tile_access.views.validate_tile_request`` whether the request may proceed.
That view checks:

* an API token (``TileAccessToken``): revocable, optionally expiring, and
  limited to specific ``TileLayer`` rows, or
* the GeoTrak session cookie of a signed-in manager/editor/admin (the web map).

Usage is aggregated per day in ``TileUsageDaily`` (one upsert per tile), not
logged one row per request.
"""
import hashlib
import secrets

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

TOKEN_PREFIX = "gtk_"
TOKEN_DISPLAY_PREFIX_LENGTH = 12  # "gtk_" + 8 chars, safe to show and log

source_id_validator = RegexValidator(
    r"^[A-Za-z0-9_]+$",
    "Use letters, digits and underscores only (must match the Martin source id).",
)


def hash_token(raw_token: str) -> str:
    """SHA-256 hex digest. Only the hash is stored; the raw token is shown once."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


class TileLayer(models.Model):
    """A Martin source that may be requested through /tiles/<slug>/... on GeoTrak's port."""

    slug = models.CharField(
        max_length=64,
        unique=True,
        validators=[source_id_validator],
        help_text="Martin source id, e.g. riyadh_roads.",
    )
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive layers are refused for every token and session.",
    )
    allow_session_access = models.BooleanField(
        default=True,
        help_text="Signed-in GeoTrak users (manager/editor/admin) may load it in the web map.",
    )
    allow_anonymous_access = models.BooleanField(
        default=False,
        help_text="Anyone may load it without a token (e.g. the public landing map). "
        "While on, tokens are only needed for attribution and usage stats.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self):
        return self.slug


class TileAccessToken(models.Model):
    """An API token for external tile clients (QGIS, partner apps, companion maps)."""

    name = models.CharField(max_length=150, help_text="Who or what uses this token.")
    token_prefix = models.CharField(max_length=16, db_index=True, editable=False)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    layers = models.ManyToManyField(TileLayer, related_name="tokens", blank=True)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tile_tokens_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="Empty = never expires.")
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tile_tokens_revoked",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.token_prefix}…)"

    @classmethod
    def issue(cls, *, name, layers, created_by=None, expires_at=None, notes=""):
        """Create a token and return ``(token, raw_token)``. The raw value is never stored."""
        raw_token = TOKEN_PREFIX + secrets.token_urlsafe(32)
        token = cls.objects.create(
            name=name,
            token_prefix=raw_token[:TOKEN_DISPLAY_PREFIX_LENGTH],
            token_hash=hash_token(raw_token),
            created_by=created_by,
            expires_at=expires_at,
            notes=notes,
        )
        token.layers.set(layers)
        return token, raw_token

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and timezone.now() >= self.expires_at

    @property
    def is_active(self) -> bool:
        return not self.is_revoked and not self.is_expired

    def revoke(self, by=None):
        if self.revoked_at is None:
            self.revoked_at = timezone.now()
            self.revoked_by = by
            self.save(update_fields=["revoked_at", "revoked_by"])


class TileUsageDaily(models.Model):
    """Per-day tile request counter for one (layer, token-or-user) pair."""

    date = models.DateField()
    layer = models.ForeignKey(TileLayer, on_delete=models.CASCADE, related_name="usage")
    token = models.ForeignKey(
        TileAccessToken,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="usage",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="tile_usage",
    )
    request_count = models.PositiveBigIntegerField(default=0)
    last_request_at = models.DateTimeField()

    class Meta:
        ordering = ["-date"]
        constraints = [
            # NULLS NOT DISTINCT (PostgreSQL 15+), so a token-only or user-only row is still unique.
            models.UniqueConstraint(
                fields=["date", "layer", "token", "user"],
                name="tile_usage_daily_unique",
                nulls_distinct=False,
            ),
        ]

    def __str__(self):
        who = self.token or self.user or "anonymous"
        return f"{self.date} {self.layer} {who}: {self.request_count}"
