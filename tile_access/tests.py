from datetime import timedelta
from unittest import skipUnless

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from system_admin.models import UserProfile
from tile_access.models import TileAccessToken, TileLayer, TileUsageDaily, hash_token
from tile_access.services import parse_original_uri

SECRET = "test-shared-secret"
VALIDATE_URL = "/tiles-auth/validate/"


@override_settings(TILE_AUTH_SHARED_SECRET=SECRET)
class ValidateTileRequestTests(TestCase):
    def setUp(self):
        self.roads = TileLayer.objects.get(slug="riyadh_roads")  # seeded by migration 0002
        # Seeded as public (landing page); most tests cover the locked-down mode.
        self.roads.allow_anonymous_access = False
        self.roads.save()
        self.other = TileLayer.objects.create(slug="other_layer", name="Other")
        self.client = Client()

    def _validate(self, uri, client=None, **headers):
        headers.setdefault("HTTP_X_TILE_AUTH_SECRET", SECRET)
        return (client or self.client).get(VALIDATE_URL, HTTP_X_ORIGINAL_URI=uri, **headers)

    def _token(self, layers=None, **kwargs):
        return TileAccessToken.issue(name="test", layers=layers or [self.roads], **kwargs)

    # ------------------------------------------------------------ guard rails
    def test_missing_shared_secret_is_refused(self):
        _, raw = self._token()
        response = self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}", HTTP_X_TILE_AUTH_SECRET="wrong")
        self.assertEqual(response.status_code, 403)

    def test_no_credentials_returns_401(self):
        self.assertEqual(self._validate("/tiles/riyadh_roads/1/2/3").status_code, 401)

    def test_malformed_path_is_refused(self):
        self.assertEqual(self._validate("/tiles/riyadh_roads/catalog").status_code, 403)

    def test_unknown_layer_is_refused(self):
        _, raw = self._token()
        self.assertEqual(self._validate(f"/tiles/secret_table/1/2/3?token={raw}").status_code, 403)

    def test_inactive_layer_is_refused(self):
        _, raw = self._token()
        TileLayer.objects.filter(pk=self.roads.pk).update(is_active=False)
        self.assertEqual(self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}").status_code, 403)

    # ------------------------------------------------------------ tokens
    def test_valid_query_token_is_allowed_and_logged(self):
        token, raw = self._token()
        first = self._validate(f"/tiles/riyadh_roads/14/9000/7000?v=5&token={raw}")
        self._validate(f"/tiles/riyadh_roads/14/9001/7000.pbf?token={raw}")

        self.assertEqual(first.status_code, 204)
        self.assertEqual(first["X-Tile-Token-Id"], token.token_prefix)
        token.refresh_from_db()
        self.assertIsNotNone(token.last_used_at)

    def test_bearer_and_header_tokens_are_accepted(self):
        _, raw = self._token()
        self.assertEqual(
            self._validate("/tiles/riyadh_roads/1/2/3", HTTP_AUTHORIZATION=f"Bearer {raw}").status_code, 204
        )
        self.assertEqual(self._validate("/tiles/riyadh_roads/1/2/3", HTTP_X_TILE_TOKEN=raw).status_code, 204)

    def test_revoked_token_is_refused_immediately(self):
        token, raw = self._token()
        self.assertEqual(self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}").status_code, 204)
        token.revoke()
        self.assertEqual(self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}").status_code, 403)

    def test_expired_token_is_refused(self):
        _, raw = self._token(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}").status_code, 403)

    def test_token_is_limited_to_its_layers(self):
        _, raw = self._token(layers=[self.other])
        self.assertEqual(self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}").status_code, 403)
        self.assertEqual(self._validate(f"/tiles/other_layer/1/2/3?token={raw}").status_code, 204)

    def test_unknown_token_is_refused_even_with_session(self):
        user = get_user_model().objects.create_superuser("admin", "admin@example.com", "pw-12345!")
        client = Client()
        client.force_login(user)
        self.assertEqual(self._validate("/tiles/riyadh_roads/1/2/3?token=gtk_bogus", client=client).status_code, 403)

    def test_only_hash_is_stored(self):
        token, raw = self._token()
        self.assertNotEqual(token.token_hash, raw)
        self.assertTrue(raw.startswith(token.token_prefix))
        self.assertFalse(TileAccessToken.objects.filter(token_hash=raw).exists())

    # ------------------------------------------------------------ sessions
    def _session_client(self, role=None, superuser=False):
        user_model = get_user_model()
        if superuser:
            user = user_model.objects.create_superuser("root", "root@example.com", "pw-12345!")
        else:
            user = user_model.objects.create_user(f"u_{role}", f"{role}@example.com", "pw-12345!")
            UserProfile.objects.create(user=user, role=role)
        client = Client()
        client.force_login(user)
        return client, user

    def test_editor_session_is_allowed_and_logged(self):
        client, user = self._session_client(role="editor")
        response = self._validate("/tiles/riyadh_roads/1/2/3", client=client)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response["X-Tile-Token-Id"], "session")

    def test_superuser_session_is_allowed(self):
        client, _ = self._session_client(superuser=True)
        self.assertEqual(self._validate("/tiles/riyadh_roads/1/2/3", client=client).status_code, 204)

    def test_session_without_role_is_refused(self):
        client, _ = self._session_client(role=None)
        self.assertEqual(self._validate("/tiles/riyadh_roads/1/2/3", client=client).status_code, 401)

    def test_token_only_layer_rejects_sessions(self):
        TileLayer.objects.filter(pk=self.roads.pk).update(allow_session_access=False)
        client, _ = self._session_client(role="manager")
        self.assertEqual(self._validate("/tiles/riyadh_roads/1/2/3", client=client).status_code, 401)

    # ------------------------------------------------------------ anonymous
    def test_seeded_riyadh_layer_is_public_for_landing_page(self):
        self.assertTrue(
            TileLayer._meta.get_field("allow_anonymous_access").default is False
        )
        TileLayer.objects.filter(pk=self.roads.pk).update(allow_anonymous_access=True)
        response = self._validate("/tiles/riyadh_roads/1/2/3")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response["X-Tile-Token-Id"], "anonymous")

    def test_revoked_token_is_refused_even_on_public_layer(self):
        TileLayer.objects.filter(pk=self.roads.pk).update(allow_anonymous_access=True)
        token, raw = self._token()
        token.revoke()
        self.assertEqual(self._validate(f"/tiles/riyadh_roads/1/2/3?token={raw}").status_code, 403)

    def test_validation_does_not_touch_session_activity(self):
        client, _ = self._session_client(role="editor")
        self._validate("/tiles/riyadh_roads/1/2/3", client=client)
        self.assertNotIn("last_seen_at", client.session)


@skipUnless(connection.vendor == "postgresql", "usage upsert uses PostgreSQL ON CONFLICT ON CONSTRAINT")
@override_settings(TILE_AUTH_SHARED_SECRET=SECRET, TILE_ACCESS_LOG_SESSION_USAGE=True)
class UsageCountingTests(TestCase):
    """One TileUsageDaily row per (day, layer, token-or-user) with an atomic counter."""

    def setUp(self):
        self.roads = TileLayer.objects.get(slug="riyadh_roads")

    def _hit(self, client, uri, n=1):
        for _ in range(n):
            client.get(VALIDATE_URL, HTTP_X_ORIGINAL_URI=uri, HTTP_X_TILE_AUTH_SECRET=SECRET)

    def test_token_requests_are_counted(self):
        token, raw = TileAccessToken.issue(name="t", layers=[self.roads])
        self._hit(Client(), f"/tiles/riyadh_roads/1/2/3?token={raw}", n=3)
        self.assertEqual(TileUsageDaily.objects.get(token=token, layer=self.roads).request_count, 3)

    def test_session_requests_are_counted_per_user(self):
        user = get_user_model().objects.create_user("ed", "ed@example.com", "pw-12345!")
        UserProfile.objects.create(user=user, role="editor")
        client = Client()
        client.force_login(user)
        self._hit(client, "/tiles/riyadh_roads/1/2/3", n=2)
        self.assertEqual(TileUsageDaily.objects.get(user=user, token=None).request_count, 2)

    def test_anonymous_requests_share_one_row(self):
        TileLayer.objects.filter(pk=self.roads.pk).update(allow_anonymous_access=True)
        self._hit(Client(), "/tiles/riyadh_roads/1/2/3", n=4)
        usage = TileUsageDaily.objects.get(layer=self.roads, token=None, user=None)
        self.assertEqual(usage.request_count, 4)


class ParseOriginalUriTests(TestCase):
    def test_parses_source_and_query(self):
        self.assertEqual(parse_original_uri("/tiles/riyadh_roads/1/2/3?v=9"), ("riyadh_roads", "v=9"))

    def test_rejects_other_paths(self):
        for uri in ("/tiles/../catalog", "/tiles/riyadh_roads/1/2", "/mapping/", ""):
            self.assertEqual(parse_original_uri(uri), (None, ""))


class TileTokensCommandTests(TestCase):
    """``manage.py tile_tokens`` (create / list / revoke / usage / layers / set-layer / add-layer)."""

    def _call(self, *args):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command("tile_tokens", *args, stdout=out)
        return out.getvalue()

    def test_create_prints_raw_token_once_and_stores_hash(self):
        output = self._call("create", "--name", "QGIS", "--layers", "riyadh_roads", "--days", "7")
        raw = next(line.strip() for line in output.splitlines() if line.strip().startswith("gtk_"))
        token = TileAccessToken.objects.get(name="QGIS")
        self.assertEqual(token.token_hash, hash_token(raw))
        self.assertEqual(list(token.layers.values_list("slug", flat=True)), ["riyadh_roads"])
        self.assertIsNotNone(token.expires_at)

    def test_create_rejects_unknown_layer(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            self._call("create", "--name", "x", "--layers", "nope")

    def test_list_and_revoke_by_prefix(self):
        token, _ = TileAccessToken.issue(name="Partner", layers=[TileLayer.objects.get(slug="riyadh_roads")])
        self.assertIn(token.token_prefix, self._call("list"))
        self._call("revoke", token.token_prefix)
        token.refresh_from_db()
        self.assertTrue(token.is_revoked)
        self.assertNotIn(token.token_prefix, self._call("list"))
        self.assertIn(token.token_prefix, self._call("list", "--all"))

    def test_set_layer_and_add_layer(self):
        self._call("set-layer", "riyadh_roads", "--no-anonymous")
        self.assertFalse(TileLayer.objects.get(slug="riyadh_roads").allow_anonymous_access)
        self._call("add-layer", "water_mains", "--name", "Water mains", "--no-session")
        layer = TileLayer.objects.get(slug="water_mains")
        self.assertFalse(layer.allow_session_access)
        self.assertIn("water_mains", self._call("layers"))

    def test_add_layer_rejects_invalid_source_id(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            self._call("add-layer", "bad-name!", "--name", "Bad")

    def test_usage_reports_counts(self):
        token, _ = TileAccessToken.issue(name="Counted", layers=[TileLayer.objects.get(slug="riyadh_roads")])
        TileUsageDaily.objects.create(
            date=timezone.localdate(), layer=TileLayer.objects.get(slug="riyadh_roads"),
            token=token, request_count=42, last_request_at=timezone.now(),
        )
        self.assertIn("42", self._call("usage"))


class LoadtestFixtureCommandTests(TestCase):
    def test_fixture_creates_editor_and_token_then_cleans_up(self):
        import json
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command("tile_loadtest_fixture", stdout=out)
        data = json.loads(out.getvalue())
        user = get_user_model().objects.get(username=data["email"])
        self.assertEqual(user.profile.role, "editor")
        self.assertTrue(user.check_password(data["password"]))
        self.assertTrue(TileAccessToken.objects.get(name="loadtest (auto)").is_active)

        call_command("tile_loadtest_fixture", "--cleanup", stdout=StringIO())
        self.assertFalse(get_user_model().objects.filter(username=data["email"]).exists())
        self.assertTrue(TileAccessToken.objects.get(name="loadtest (auto)").is_revoked)
