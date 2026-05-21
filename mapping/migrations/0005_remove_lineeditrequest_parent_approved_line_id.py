from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("mapping", "0004_lineeditrequest_layer_upload_feature_id"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="lineeditrequest",
            name="parent_approved_line_id",
        ),
    ]
