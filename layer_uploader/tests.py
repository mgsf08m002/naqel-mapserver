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

        self.assertRedirects(response, reverse("success"))
        compare_mock.assert_called_once_with("C:\\temp\\naqel-upload\\uploaded_roads.shp")

        layer = Layer.objects.get()
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

    def test_validate_post_creates_no_features_when_all_exist(self):
        with (
            patch("layer_uploader.views._find_shapefile_path", return_value="C:\\temp\\naqel-upload\\uploaded_roads.shp"),
            patch("layer_uploader.views.fiona.open", return_value=_StubFionaSource()),
            patch("layer_uploader.views.find_new_features_against_riyadh_roads", return_value=[]),
        ):
            response = self.client.post(reverse("validate"))

        self.assertRedirects(response, reverse("success"))

        layer = Layer.objects.get()
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
