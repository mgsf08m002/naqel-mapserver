from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def forwards_status_mapping(apps, schema_editor):
    Feature = apps.get_model("layer_uploader", "Feature")
    mapping = {
        "pending": "staged",
        "approved": "nominated",
        "rejected": "rejected_upload",
    }
    for old, new in mapping.items():
        Feature.objects.filter(status=old).update(status=new)


def backwards_status_mapping(apps, schema_editor):
    Feature = apps.get_model("layer_uploader", "Feature")
    mapping = {
        "staged": "pending",
        "nominated": "approved",
        "rejected_upload": "rejected",
        "awaiting_manager": "approved",
        "rejected_manager": "rejected",
    }
    for old, new in mapping.items():
        Feature.objects.filter(status=old).update(status=new)


class Migration(migrations.Migration):

    dependencies = [
        ("layer_uploader", "0003_alter_feature_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="layer",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("submitted", "Submitted for manager review"),
                    ("completed", "Completed"),
                ],
                db_index=True,
                default="draft",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="layer",
            name="submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="layer",
            name="completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="feature",
            name="status",
            field=models.CharField(
                choices=[
                    ("staged", "Staged"),
                    ("nominated", "Nominated for manager"),
                    ("rejected_upload", "Rejected by uploader"),
                    ("awaiting_manager", "Awaiting manager"),
                    ("rejected_manager", "Rejected by manager"),
                ],
                db_index=True,
                default="staged",
                max_length=20,
            ),
        ),
        migrations.RunPython(forwards_status_mapping, backwards_status_mapping),
        migrations.AddField(
            model_name="feature",
            name="remote_road_id",
            field=models.FloatField(
                blank=True,
                help_text="Assigned id on riyadh_roads after manager approval (audit only; row removed after publish).",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="feature",
            name="reviewed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="reviewed_upload_features",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="feature",
            name="reviewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
