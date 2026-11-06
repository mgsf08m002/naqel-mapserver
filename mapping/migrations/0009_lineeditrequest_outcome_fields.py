from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("mapping", "0008_lineeditrequest_published_road_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="lineeditrequest",
            name="rejection_reason",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Manager rejection note; empty when they chose No reason.",
            ),
        ),
        migrations.AddField(
            model_name="lineeditrequest",
            name="outcome_read_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the editor dismissed the approve/reject outcome notification.",
                null=True,
            ),
        ),
    ]
