from django.contrib.gis.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class Layer(models.Model):
    name = models.CharField(max_length=255)

    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='layers'
    )

    uploaded_at = models.DateTimeField(auto_now_add=True)

    srid = models.IntegerField(null=True, blank=True)

    total_features = models.IntegerField(default=0)
    new_features = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.name} ({self.uploaded_by})"


# class Feature(models.Model):
#     layer = models.ForeignKey(
#         Layer,
#         on_delete=models.CASCADE,
#         related_name='features'
#     )
#
#     geom = models.GeometryField(srid=4326)
#
#     def __str__(self):
#         return f"Feature {self.id} - {self.layer.name}"