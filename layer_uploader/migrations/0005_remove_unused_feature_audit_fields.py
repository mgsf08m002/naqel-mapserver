from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("layer_uploader", "0004_layer_upload_workflow"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="feature",
            name="remote_road_id",
        ),
        migrations.RemoveField(
            model_name="feature",
            name="reviewed_by",
        ),
        migrations.RemoveField(
            model_name="feature",
            name="reviewed_at",
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
                ],
                db_index=True,
                default="staged",
                max_length=20,
            ),
        ),
    ]
