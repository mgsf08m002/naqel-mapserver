from django.db import migrations


def seed_riyadh_roads(apps, schema_editor):
    TileLayer = apps.get_model('tile_access', 'TileLayer')
    TileLayer.objects.get_or_create(
        slug='riyadh_roads',
        defaults={
            'name': 'Riyadh roads',
            'description': 'Live Riyadh road network (riyadh_roads DB, public.riyadh_roads).',
            # The public landing page (home.landing_view) shows this layer to anonymous
            # visitors, as the old Django tile proxy did. Turn it off to require a token
            # or session:  python manage.py tile_tokens set-layer riyadh_roads --no-anonymous
            'allow_anonymous_access': True,
        },
    )


class Migration(migrations.Migration):

    dependencies = [
        ('tile_access', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_riyadh_roads, migrations.RunPython.noop),
    ]
