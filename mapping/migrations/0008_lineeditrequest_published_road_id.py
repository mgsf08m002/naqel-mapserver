from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("mapping", "0007_alter_lineeditrequest_options_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="lineeditrequest",
            name="published_road_id",
            field=models.IntegerField(
                blank=True,
                help_text="Tile/network id after approval (for map deep links)",
                null=True,
            ),
        ),
    ]
