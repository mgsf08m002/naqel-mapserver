from django.contrib.gis.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class Layer(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        COMPLETED = "completed", "Completed"

    name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="layers",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    srid = models.IntegerField(null=True, blank=True)
    total_features = models.IntegerField(default=0)
    new_features = models.IntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.name} ({self.uploaded_by})"


class Feature(models.Model):
    class Status(models.TextChoices):
        STAGED = "staged", "New"
        NOMINATED = "nominated", "Approved"
        REJECTED_UPLOAD = "rejected_upload", "Rejected"
        AWAITING_MANAGER = "awaiting_manager", "Awaiting review"

    layer = models.ForeignKey(Layer, on_delete=models.CASCADE, related_name="features")
    geom = models.GeometryField(srid=4326)
    properties = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.STAGED,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    uploaded_at = models.DateTimeField(auto_now=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name="features")

    def __str__(self):
        return f"Feature {self.id} - {self.layer.name}"
