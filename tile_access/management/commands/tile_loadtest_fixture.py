"""
Create (or remove) throwaway credentials for the geo-infra smoke, latency, and load tests.

    python manage.py tile_loadtest_fixture            # prints JSON {email, password, token, ...}
    python manage.py tile_loadtest_fixture --cleanup  # revokes test tokens, deletes the test user

Everything it creates is namespaced "loadtest" so it is easy to spot and remove.
The token expires after one day, even if --cleanup is never run.
"""
import json
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from system_admin.models import UserProfile
from tile_access.models import TileAccessToken, TileLayer

LOADTEST_EMAIL = "loadtest-editor@geotrak.invalid"
LOADTEST_TOKEN_NAME = "loadtest (auto)"


class Command(BaseCommand):
    help = "Create or remove the GeoTrak load-test user and tile token (JSON on stdout)."

    def add_arguments(self, parser):
        parser.add_argument("--cleanup", action="store_true")
        parser.add_argument("--layer", default="riyadh_roads")

    def handle(self, *args, **opts):
        user_model = get_user_model()
        if opts["cleanup"]:
            revoked = 0
            for token in TileAccessToken.objects.filter(name=LOADTEST_TOKEN_NAME, revoked_at__isnull=True):
                token.revoke()
                revoked += 1
            deleted, _ = user_model.objects.filter(username=LOADTEST_EMAIL).delete()
            self.stdout.write(json.dumps({"revoked_tokens": revoked, "deleted_users": bool(deleted)}))
            return

        layer = TileLayer.objects.filter(slug=opts["layer"]).first()
        if layer is None:
            raise CommandError(f"Unknown tile layer '{opts['layer']}'.")

        password = secrets.token_urlsafe(18)
        user, _ = user_model.objects.get_or_create(
            username=LOADTEST_EMAIL, defaults={"email": LOADTEST_EMAIL}
        )
        user.set_password(password)
        user.is_active = True
        user.save()
        UserProfile.objects.update_or_create(
            user=user, defaults={"role": "editor", "password_setup_completed": True}
        )

        _, raw_token = TileAccessToken.issue(
            name=LOADTEST_TOKEN_NAME,
            layers=[layer],
            expires_at=timezone.now() + timedelta(days=1),
            notes="Created by tile_loadtest_fixture; safe to revoke.",
        )
        self.stdout.write(json.dumps({
            "email": LOADTEST_EMAIL,
            "password": password,
            "token": raw_token,
            "layer": layer.slug,
            "layer_allows_anonymous": layer.allow_anonymous_access,
        }))
