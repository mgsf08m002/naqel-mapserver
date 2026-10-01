import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TileLayer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.CharField(help_text='Martin source id, e.g. riyadh_roads.', max_length=64, unique=True, validators=[django.core.validators.RegexValidator('^[A-Za-z0-9_]+$', 'Use letters, digits and underscores only (must match the Martin source id).')])),
                ('name', models.CharField(max_length=150)),
                ('description', models.TextField(blank=True, default='')),
                ('is_active', models.BooleanField(default=True, help_text='Inactive layers are refused for every token and session.')),
                ('allow_session_access', models.BooleanField(default=True, help_text='Signed-in GeoTrak users (manager/editor/admin) may load it in the web map.')),
                ('allow_anonymous_access', models.BooleanField(default=False, help_text='Anyone may load it without a token (e.g. the public landing map). While on, tokens are only needed for attribution and usage stats.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['slug'],
            },
        ),
        migrations.CreateModel(
            name='TileAccessToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Who or what uses this token.', max_length=150)),
                ('token_prefix', models.CharField(db_index=True, editable=False, max_length=16)),
                ('token_hash', models.CharField(editable=False, max_length=64, unique=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(blank=True, help_text='Empty = never expires.', null=True)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tile_tokens_created', to=settings.AUTH_USER_MODEL)),
                ('revoked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tile_tokens_revoked', to=settings.AUTH_USER_MODEL)),
                ('layers', models.ManyToManyField(blank=True, related_name='tokens', to='tile_access.tilelayer')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='TileUsageDaily',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField()),
                ('request_count', models.PositiveBigIntegerField(default=0)),
                ('last_request_at', models.DateTimeField()),
                ('layer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='usage', to='tile_access.tilelayer')),
                ('token', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='usage', to='tile_access.tileaccesstoken')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='tile_usage', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-date'],
                'constraints': [models.UniqueConstraint(fields=('date', 'layer', 'token', 'user'), name='tile_usage_daily_unique', nulls_distinct=False)],
            },
        ),
    ]
