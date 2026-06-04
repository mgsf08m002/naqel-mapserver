from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.contrib.gis.db import models as gis_models
import json


class LineEditRequest(models.Model):
    """Pending road edits awaiting manager approval (or historical approved/rejected rows)."""

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    requester = models.ForeignKey(User, on_delete=models.CASCADE, related_name='line_edit_requests')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    request_category = models.CharField(
        max_length=32,
        blank=True,
        default='',
        help_text='Approval queue category key (see mapping.approval_categories).',
    )
    edit_type = models.CharField(
        max_length=50,
        blank=True,
        default='',
        help_text='Legacy workflow marker: DELETE or Layer Upload only; use request_category in UI.',
    )

    geometry = models.JSONField(help_text='Road geometry as GeoJSON LineString or MultiLineString')

    # Snapshot of geometry before this edit (WGS84 GeoJSON) for Riyadh roads / review UI.
    original_geometry = models.JSONField(
        null=True,
        blank=True,
        help_text="Pre-edit geometry from base network (GeoJSON, WGS84)",
    )
    geometry_changed = models.BooleanField(
        default=False,
        help_text="True when proposed geometry differs from original_geometry",
    )
    # Backward-compatible field: older DB schema used `has_geometry_change`
    # (NOT NULL, no default). We keep it in sync with `geometry_changed`
    # so inserts/updates never fail.
    has_geometry_change = models.BooleanField(
        db_column="has_geometry_change",
        default=False,
        help_text="Legacy alias for geometry_changed (DB: has_geometry_change).",
    )
    
    current_feature_label = models.CharField(
        max_length=200,
        blank=True,
        null=True,
        help_text='Display feature type for this road (e.g. Motorway).',
    )
    feature_type = models.CharField(
        max_length=200,
        blank=True,
        null=True,
        help_text='Deprecated mirror of current_feature_label; kept for compatibility.',
    )
    
    # Fields data (JSON)
    fields_data = models.JSONField(default=dict, blank=True, help_text="Fields section data")
    
    # Tags data (JSON)
    tags_data = models.JSONField(default=list, blank=True, help_text="Tags section data")
    
    # Relations data (JSON)
    relations_data = models.JSONField(default=list, blank=True, help_text="Relations section data")

    # Road closure flag and source metadata: 0 = open (default), 1 = closed.
    road_closure = models.IntegerField(
        default=0,
        help_text="Road closure flag: 0 = open, 1 = closed",
    )

    # Link to a RiyadhRoad feature so approval flows can update the base network when needed.
    is_riyadh_road = models.BooleanField(
        default=False,
        help_text="True when this edit request targets a RiyadhRoad feature",
    )
    riyadh_road_id = models.IntegerField(
        null=True,
        blank=True,
        help_text="Primary key of the RiyadhRoad feature when applicable",
    )
    layer_upload_feature_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text='layer_uploader.Feature pk for layer_upload requests',
    )
    published_road_id = models.IntegerField(
        null=True,
        blank=True,
        help_text="Tile/network id after approval (for map deep links)",
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='reviewed_line_edits'
    )
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Road edit request'
        verbose_name_plural = 'Road edit requests'

    def __str__(self):
        category = self.request_category or self.edit_type or 'road edit'
        return f'{self.requester.username} - {category} - {self.status} ({self.created_at.strftime("%Y-%m-%d %H:%M")})'
    
    def get_requester_role(self):
        """Get the role of the requester."""
        if self.requester.is_superuser:
            return 'System Admin'
        profile = getattr(self.requester, 'profile', None)
        if profile and profile.role:
            return profile.role.title()
        return 'User'
    
    def approve(self, reviewer):
        """Approve the edit request."""
        self.status = 'approved'
        self.reviewed_at = timezone.now()
        self.reviewed_by = reviewer
        self.save()
    
    def reject(self, reviewer):
        """Reject the edit request."""
        self.status = 'rejected'
        self.reviewed_at = timezone.now()
        self.reviewed_by = reviewer
        self.save()

    def save(self, *args, **kwargs):
        if self.current_feature_label and not self.feature_type:
            self.feature_type = self.current_feature_label
        elif self.feature_type and not self.current_feature_label:
            self.current_feature_label = self.feature_type
        self.has_geometry_change = bool(self.geometry_changed)
        super().save(*args, **kwargs)


class RiyadhRoad(gis_models.Model):
    gid = gis_models.AutoField(primary_key=True, db_column="gid")
    id = gis_models.FloatField(null=True, blank=True, db_column="id")
    objectid = gis_models.DecimalField(max_digits=20, decimal_places=0, null=True, blank=True)
    osm_id = gis_models.CharField(max_length=12, null=True, blank=True)
    code = gis_models.FloatField(null=True, blank=True)
    fclass = gis_models.CharField(max_length=28, null=True, blank=True)
    name = gis_models.CharField(max_length=100, null=True, blank=True)
    ref = gis_models.CharField(max_length=20, null=True, blank=True)
    oneway = gis_models.CharField(max_length=1, null=True, blank=True)
    maxspeed = gis_models.FloatField(null=True, blank=True)
    layer = gis_models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    bridge = gis_models.CharField(max_length=1, null=True, blank=True)
    tunnel = gis_models.CharField(max_length=1, null=True, blank=True)
    shape_length = gis_models.DecimalField(
        max_digits=20,
        decimal_places=6,
        null=True,
        blank=True,
        db_column="shape_leng",
    )
    geom = gis_models.MultiLineStringField(srid=3857)
    road_closure = gis_models.IntegerField(null=False, blank=False, default=0)

    class Meta:
        db_table = "riyadh_roads"
        managed = False

    def __str__(self):
        return f"{self.name or 'Unnamed Road'} ({self.fclass or 'Unknown'})"
