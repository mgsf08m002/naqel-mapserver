from django.contrib import admin

from .models import SymbologyStyle


@admin.register(SymbologyStyle)
class SymbologyStyleAdmin(admin.ModelAdmin):
    list_display = (
        "label",
        "line_color",
        "glow_color",
        "line_width",
        "glow_width",
        "glow_opacity",
        "is_active",
    )
    list_filter = ("is_active",)
    search_fields = ("label",)
    ordering = ("label",)

