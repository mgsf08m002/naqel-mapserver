import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import GEOSGeometry
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from .models import Feature, Layer
from .utils import _geometry_from_db_wkb


class _StubFionaSource:
    crs = 'PROJCS["WGS 84 / Pseudo-Mercator",AUTHORITY["EPSG","3857"]]'

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def __len__(self):
        return 12


class ValidateViewTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="testpass123",
        )
        self.client.force_login(self.user)

        session = self.client.session
        session["temp_dir"] = "C:\\temp\\naqel-upload"
        session["selected"] = "uploaded_roads"
        session.save()

    def _make_stub_new_features(self, count):
        """Return a list of stub new-feature dicts like the real function returns."""
        return [
            {
                "geom": GEOSGeometry("POINT(46.68 24.71)", srid=4326),
                "properties": {"name": f"road_{i}"},
            }
            for i in range(count)
        ]

    def test_validate_post_stores_new_features_from_geometry_comparison(self):
        stub_features = self._make_stub_new_features(4)

        with (
            patch("layer_uploader.views._find_shapefile_path", return_value="C:\\temp\\naqel-upload\\uploaded_roads.shp"),
            patch("layer_uploader.views.fiona.open", return_value=_StubFionaSource()),
            patch("layer_uploader.views.find_new_features_against_riyadh_roads", return_value=stub_features) as compare_mock,
        ):
            response = self.client.post(reverse("validate"))

        layer = Layer.objects.get()
        self.assertRedirects(response, reverse("layer_review", kwargs={"layer_id": layer.pk}))
        compare_mock.assert_called_once_with("C:\\temp\\naqel-upload\\uploaded_roads.shp")
        self.assertEqual(layer.name, "uploaded_roads")
        self.assertEqual(layer.total_features, 12)
        self.assertEqual(layer.new_features, 4)
        self.assertEqual(layer.srid, 3857)

        # Verify Feature objects were created and linked to the layer.
        features = Feature.objects.filter(layer=layer)
        self.assertEqual(features.count(), 4)
        for feat in features:
            self.assertEqual(feat.uploaded_by, self.user)
            self.assertIsNotNone(feat.geom)
            self.assertIn("name", feat.properties)
            self.assertEqual(feat.status, Feature.Status.PENDING)

    def test_validate_post_creates_no_features_when_all_exist(self):
        with (
            patch("layer_uploader.views._find_shapefile_path", return_value="C:\\temp\\naqel-upload\\uploaded_roads.shp"),
            patch("layer_uploader.views.fiona.open", return_value=_StubFionaSource()),
            patch("layer_uploader.views.find_new_features_against_riyadh_roads", return_value=[]),
        ):
            response = self.client.post(reverse("validate"))

        layer = Layer.objects.get()
        self.assertRedirects(response, reverse("layer_review", kwargs={"layer_id": layer.pk}))
        self.assertEqual(layer.new_features, 0)
        self.assertEqual(Feature.objects.count(), 0)

    def test_validate_post_renders_error_when_geometry_comparison_fails(self):
        with (
            patch("layer_uploader.views._find_shapefile_path", return_value="C:\\temp\\naqel-upload\\uploaded_roads.shp"),
            patch("layer_uploader.views.fiona.open", return_value=_StubFionaSource()),
            patch(
                "layer_uploader.views.find_new_features_against_riyadh_roads",
                side_effect=RuntimeError("comparison failed"),
            ),
        ):
            response = self.client.post(reverse("validate"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Failed to compare uploaded features against Riyadh roads")
        self.assertEqual(Layer.objects.count(), 0)
        self.assertEqual(Feature.objects.count(), 0)


class LayerReviewApiTests(TestCase):
    """Review page JSON/GeoJSON/action endpoints match layer_review.js expectations."""

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_superuser(
            username="review_api_admin",
            email="review_api@example.com",
            password="testpass123",
        )
        self.client.force_login(self.user)
        self.layer = Layer.objects.create(
            name="review_test_layer",
            uploaded_by=self.user,
            srid=4326,
            total_features=3,
            new_features=3,
        )
        self.geom = GEOSGeometry("POINT(46.68 24.71)", srid=4326)
        self.pending = Feature.objects.create(
            layer=self.layer,
            geom=self.geom,
            properties={"name": "pending_road"},
            status=Feature.Status.PENDING,
            uploaded_by=self.user,
        )
        self.approved = Feature.objects.create(
            layer=self.layer,
            geom=GEOSGeometry("POINT(46.69 24.72)", srid=4326),
            properties={"name": "approved_road"},
            status=Feature.Status.APPROVED,
            uploaded_by=self.user,
        )
        self.rejected = Feature.objects.create(
            layer=self.layer,
            geom=GEOSGeometry("POINT(46.70 24.73)", srid=4326),
            properties={"name": "rejected_road"},
            status=Feature.Status.REJECTED,
            uploaded_by=self.user,
        )

    def test_review_table_json_returns_rows_and_counts(self):
        response = self.client.get(
            reverse("layer_review_table", kwargs={"layer_id": self.layer.pk})
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["layer"]["id"], self.layer.pk)
        self.assertEqual(payload["counts"], {"pending": 1, "approved": 1, "rejected": 1})
        self.assertEqual(len(payload["features"]), 3)

        row = next(r for r in payload["features"] if r["id"] == self.pending.pk)
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["property_entries"], [{"key": "name", "value": "pending_road"}])
        self.assertEqual(len(row["center"]), 2)
        self.assertEqual(len(row["bbox"]), 2)
        self.assertEqual(row["geometry"]["type"], "Point")

    def test_review_geojson_includes_only_approved_features(self):
        response = self.client.get(
            reverse("layer_review_geojson", kwargs={"layer_id": self.layer.pk})
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["type"], "FeatureCollection")
        self.assertEqual(len(payload["features"]), 1)
        feature = payload["features"][0]
        self.assertEqual(feature["id"], self.approved.pk)
        self.assertEqual(feature["properties"]["upload_feature_id"], self.approved.pk)
        self.assertEqual(feature["geometry"]["type"], "Point")

    def test_review_action_updates_single_feature_status(self):
        url = reverse("layer_review_action", kwargs={"layer_id": self.layer.pk})
        response = self.client.post(
            url,
            data=json.dumps({"action": "approve", "feature_id": self.pending.pk}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Feature.Status.APPROVED)

    def test_review_action_bulk_approve_all(self):
        url = reverse("layer_review_action", kwargs={"layer_id": self.layer.pk})
        response = self.client.post(
            url,
            data=json.dumps({"action": "approve_all"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated"], 3)
        statuses = set(Feature.objects.filter(layer=self.layer).values_list("status", flat=True))
        self.assertEqual(statuses, {Feature.Status.APPROVED})

    def test_review_json_endpoints_forbid_other_users(self):
        from system_admin.models import UserProfile

        editor = get_user_model().objects.create_user(
            username="review_editor",
            email="editor@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=editor,
            role="editor",
            can_access_layer_uploader=True,
        )
        other_layer = Layer.objects.create(
            name="other_layer",
            uploaded_by=self.user,
            srid=4326,
        )
        self.client.force_login(editor)
        table_url = reverse("layer_review_table", kwargs={"layer_id": other_layer.pk})
        response = self.client.get(table_url)
        self.assertEqual(response.status_code, 403)


class GeometryLoadingTests(SimpleTestCase):
    def test_geometry_from_db_wkb_wraps_bytes_in_memoryview(self):
        fake_geom = type("FakeGeom", (), {})()

        with patch("layer_uploader.utils.GEOSGeometry", return_value=fake_geom) as geos_mock:
            result = _geometry_from_db_wkb(b"\x01\x02\x03\x04", srid=3857)

        self.assertIs(result, fake_geom)
        geos_input = geos_mock.call_args.args[0]
        self.assertIsInstance(geos_input, memoryview)
        self.assertEqual(geos_input.tobytes(), b"\x01\x02\x03\x04")
        self.assertEqual(result.srid, 3857)
