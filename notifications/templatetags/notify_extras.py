import json

from django import template
from django.utils.safestring import mark_safe

register = template.Library()

# Aligns Django contrib.messages tags with the frontend notify types.
_TAGS_TO_NOTIFY = {
    "error": "error",
    "warning": "warning",
    "success": "success",
    "info": "info",
    "debug": "info",
}


def django_tags_to_notify_type(tags: str) -> str:
    if not tags:
        return "info"
    parts = set(tags.split())
    for key in ("error", "warning", "success"):
        if key in parts:
            return _TAGS_TO_NOTIFY[key]
    if "debug" in parts:
        return "info"
    return "info"


@register.simple_tag
def messages_notify_json(messages) -> str:
    """Serialize Django messages for window.notify.showMany (JSON array)."""
    items = []
    for m in messages:
        items.append(
            {
                "message": str(m),
                "type": django_tags_to_notify_type(getattr(m, "tags", "") or ""),
            }
        )
    return mark_safe(json.dumps(items))
