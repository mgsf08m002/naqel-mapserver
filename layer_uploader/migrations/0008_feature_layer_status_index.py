from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("layer_uploader", "0007_alter_feature_status"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="feature",
            index=models.Index(fields=["layer", "status"], name="layer_uploader_layer_status_idx"),
        ),
    ]
