from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("mapping", "0003_lineeditrequest_has_geometry_change"),
    ]

    operations = [
        migrations.AddField(
            model_name="lineeditrequest",
            name="layer_upload_feature_id",
            field=models.PositiveIntegerField(
                blank=True,
                db_index=True,
                help_text="layer_uploader.Feature pk when edit_type is Layer Upload",
                null=True,
            ),
        ),
    ]
