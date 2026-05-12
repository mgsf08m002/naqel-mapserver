import django.contrib.gis.db.models.fields
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("layer_uploader", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="feature",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                ],
                db_index=True,
                default="pending",
                max_length=16,
            ),
            preserve_default=False,
        ),
    ]
