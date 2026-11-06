import re

from django.db import migrations, models


def _looks_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text or ""))


def forwards(apps, schema_editor):
    LineEditRequest = apps.get_model("mapping", "LineEditRequest")
    known_ar = "لا حاجة لحذف هذا الطريق. هو مناسب بالفعل."
    known_en = "No need to delete this road. It is fine already."
    for req in LineEditRequest.objects.exclude(rejection_reason="").iterator():
        text = (req.rejection_reason or "").strip()
        if not text:
            continue
        if text == known_ar or text.startswith("لا حاجة لحذف"):
            req.rejection_reason_ar = known_ar
            req.rejection_reason_en = known_en
            req.rejection_reason = known_ar
        elif _looks_arabic(text):
            req.rejection_reason_ar = text
        else:
            req.rejection_reason_en = text
        req.save(
            update_fields=[
                "rejection_reason",
                "rejection_reason_en",
                "rejection_reason_ar",
            ]
        )


def backwards(apps, schema_editor):
    LineEditRequest = apps.get_model("mapping", "LineEditRequest")
    for req in LineEditRequest.objects.all().iterator():
        en = (getattr(req, "rejection_reason_en", None) or "").strip()
        ar = (getattr(req, "rejection_reason_ar", None) or "").strip()
        if not (req.rejection_reason or "").strip():
            req.rejection_reason = ar or en
            req.save(update_fields=["rejection_reason"])


class Migration(migrations.Migration):

    dependencies = [
        ("mapping", "0009_lineeditrequest_outcome_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="lineeditrequest",
            name="rejection_reason_en",
            field=models.TextField(
                blank=True,
                default="",
                help_text="English rejection note for editors using the English UI.",
            ),
        ),
        migrations.AddField(
            model_name="lineeditrequest",
            name="rejection_reason_ar",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Arabic rejection note for editors using the Arabic UI.",
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
