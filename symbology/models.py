from django.db import models


class SymbologyStyle(models.Model):
    """
    Legacy model retained only so existing migrations continue to apply cleanly.

    All active symbology is defined exclusively in symbology/symbology.json and
    exposed via /symbology/api/catalog/. This model is no longer consulted when
    building the catalog and should not be used for new code.
    """

    label = models.CharField(
        max_length=128,
        unique=True,
        help_text="Human-readable feature label, e.g. 'Motorway' or 'Pipeline'.",
    )

    line_color = models.CharField(
        max_length=16,
        help_text="Stroke color for the line (hex, e.g. #2563eb).",
    )
    glow_color = models.CharField(
        max_length=16,
        help_text="Outer glow color around the line (hex).",
    )

    line_width = models.FloatField(
        help_text="Base line width; may be overridden globally in the catalog.",
    )
    glow_width = models.FloatField(
        help_text="Width of the outer glow around the line.",
    )
    glow_opacity = models.FloatField(
        help_text="Opacity of the glow (0.0 - 1.0).",
    )

    marker_color = models.CharField(
        max_length=16,
        help_text="Fill color for vertex markers (hex).",
    )
    marker_glow_color = models.CharField(
        max_length=16,
        help_text="Glow color for vertex markers (hex).",
    )

    is_active = models.BooleanField(
        default=True,
        help_text="Inactive styles are ignored when building the symbology catalog.",
    )

    class Meta:
        verbose_name = "Symbology Style"
        verbose_name_plural = "Symbology Styles"
        ordering = ["label"]

    def __str__(self) -> str:
        return self.label

