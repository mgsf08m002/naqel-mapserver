from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import json


class LineEditRequest(models.Model):
    """Model to store line edit requests from Editors and System Admins."""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]
    
    # Request information
    requester = models.ForeignKey(User, on_delete=models.CASCADE, related_name='line_edit_requests')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    edit_type = models.CharField(max_length=50, default='LINE EDIT')
    
    # Line geometry (GeoJSON)
    geometry = models.JSONField(help_text="LineString geometry in GeoJSON format")
    
    # Feature details
    feature_type = models.CharField(max_length=200, blank=True, null=True)
    current_feature_label = models.CharField(max_length=200, blank=True, null=True)
    
    # Fields data (JSON)
    fields_data = models.JSONField(default=dict, blank=True, help_text="Fields section data")
    
    # Tags data (JSON)
    tags_data = models.JSONField(default=list, blank=True, help_text="Tags section data")
    
    # Relations data (JSON)
    relations_data = models.JSONField(default=list, blank=True, help_text="Relations section data")
    
    # Parent approved line reference (for tracking edits to existing approved lines)
    parent_approved_line_id = models.IntegerField(blank=True, null=True, help_text='ID of the approved line being edited')
    
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
        verbose_name = 'Line Edit Request'
        verbose_name_plural = 'Line Edit Requests'
    
    def __str__(self):
        return f"{self.requester.username} - {self.edit_type} - {self.status} ({self.created_at.strftime('%Y-%m-%d %H:%M')})"
    
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
