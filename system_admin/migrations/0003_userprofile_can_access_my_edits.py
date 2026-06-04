from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("system_admin", "0002_userprofile_can_access_layer_uploader"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="can_access_my_edits",
            field=models.BooleanField(default=True),
        ),
    ]
