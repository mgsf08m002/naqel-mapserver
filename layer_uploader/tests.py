import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import GEOSGeometry
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from mapping.models import LineEditRequest
from system_admin.models import UserProfile

from mapping.approval_categories import (
    EDIT_TYPE_LAYER_UPLOAD,
    UPLOAD_SHAPEFILE_FIELD_KEY,
)
from .models import Feature, Layer
from .utils import _geometry_from_db_wkb, simplify_crs


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
        return [
            {
                "geom": GEOSGeometry("LINESTRING(46.68 24.71, 46.69 24.72)", srid=4326),
                "properties": {"name": f"road_{i}", "fclass": "residential"},
            }
            for i in range(count)
        ]

    def test_validate_post_stores_new_features_in_local_db(self):
        stub_features = self._make_stub_new_features(4)

        with (
            patch(
                "layer_uploader.views.find_shapefile_path",
                return_value="C:\\temp\\naqel-upload\\uploaded_roads.shp",
            ),
            patch("layer_uploader.views.fiona.open", return_value=_StubFionaSource()),
            patch(
                "layer_uploader.views.find_new_features_against_riyadh_roads",
                return_value=stub_features,
            ) as compare_mock,
        ):
            response = self.client.post(reverse("validate"))

        layer = Layer.objects.get()
        self.assertRedirects(
            response, reverse("layer_review", kwargs={"layer_id": layer.pk})
        )
        compare_mock.assert_called_once_with("C:\\temp\\naqel-upload\\uploaded_roads.shp")
        self.assertEqual(layer.status, Layer.Status.DRAFT)
        self.assertEqual(layer.new_features, 4)

        features = Feature.objects.filter(layer=layer)
        self.assertEqual(features.count(), 4)
        for feat in features:
            self.assertEqual(feat.status, Feature.Status.STAGED)


class UploaderWorkflowTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.editor = user_model.objects.create_user(
            username="editor",
            email="editor@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.editor,
            role="editor",
            can_access_layer_uploader=True,
            password_setup_completed=True,
        )
        self.manager = user_model.objects.create_user(
            username="manager",
            email="manager@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.manager,
            role="manager",
            can_access_layer_uploader=True,
            password_setup_completed=True,
        )
        self.layer = Layer.objects.create(
            name="test_layer",
            uploaded_by=self.editor,
            srid=4326,
            total_features=2,
            new_features=2,
            status=Layer.Status.DRAFT,
        )
        self.geom = GEOSGeometry("LINESTRING(46.68 24.71, 46.69 24.72)", srid=4326)
        self.feature = Feature.objects.create(
            layer=self.layer,
            geom=self.geom,
            properties={"name": "New Road", "fclass": "residential"},
            status=Feature.Status.STAGED,
            uploaded_by=self.editor,
        )

    def test_uploader_nominate_and_submit_creates_pending_edit_requests(self):
        self.client.force_login(self.editor)
        action_url = reverse("layer_review_action", kwargs={"layer_id": self.layer.pk})

        response = self.client.post(
            action_url,
            data=json.dumps({"action": "nominate", "feature_id": self.feature.pk}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.feature.refresh_from_db()
        self.assertEqual(self.feature.status, Feature.Status.NOMINATED)

        submit_url = reverse("layer_submit", kwargs={"layer_id": self.layer.pk})
        response = self.client.post(submit_url, data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["submitted_count"], 1)
        self.assertFalse(payload["auto_published"])

        self.layer.refresh_from_db()
        self.feature.refresh_from_db()
        self.assertEqual(self.layer.status, Layer.Status.SUBMITTED)
        self.assertEqual(self.feature.status, Feature.Status.AWAITING_MANAGER)

        edit_request = LineEditRequest.objects.get()
        self.assertEqual(edit_request.request_category, "layer_upload")
        self.assertEqual(edit_request.edit_type, EDIT_TYPE_LAYER_UPLOAD)
        self.assertEqual(edit_request.layer_upload_feature_id, self.feature.pk)
        self.assertEqual(edit_request.requester_id, self.editor.pk)
        self.assertEqual(edit_request.status, "pending")
        self.assertEqual(
            edit_request.fields_data.get(UPLOAD_SHAPEFILE_FIELD_KEY), "test_layer"
        )

    def test_manager_self_upload_auto_publishes_on_submit(self):
        manager_layer = Layer.objects.create(
            name="manager_self_layer",
            uploaded_by=self.manager,
            srid=4326,
            total_features=1,
            new_features=1,
            status=Layer.Status.DRAFT,
        )
        manager_feature = Feature.objects.create(
            layer=manager_layer,
            geom=self.geom,
            properties={"name": "Mgr Road", "fclass": "residential"},
            status=Feature.Status.STAGED,
            uploaded_by=self.manager,
        )

        self.client.force_login(self.manager)
        nominate_url = reverse("layer_review_action", kwargs={"layer_id": manager_layer.pk})
        self.client.post(
            nominate_url,
            data=json.dumps({"action": "nominate", "feature_id": manager_feature.pk}),
            content_type="application/json",
        )

        submit_url = reverse("layer_submit", kwargs={"layer_id": manager_layer.pk})

        def _fake_publish(feature):
            feature.delete()
            from layer_uploader.services import refresh_layer_completion

            refresh_layer_completion(feature.layer)
            return 88001.0

        with patch(
            "layer_uploader.services.approve_and_publish_feature",
            side_effect=_fake_publish,
        ):
            response = self.client.post(submit_url, data="{}", content_type="application/json")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["auto_published"])
        self.assertEqual(payload["published_count"], 1)
        self.assertIsNotNone(payload.get("tiles_version"))
        self.assertIn("auto_published=1", payload["redirect_url"])
        self.assertEqual(LineEditRequest.objects.count(), 0)

        manager_layer.refresh_from_db()
        self.assertEqual(manager_layer.status, Layer.Status.COMPLETED)
        self.assertFalse(Feature.objects.filter(pk=manager_feature.pk).exists())

    def test_manager_approves_layer_upload_via_map_api(self):
        self.feature.status = Feature.Status.AWAITING_MANAGER
        self.feature.save(update_fields=["status"])
        self.layer.status = Layer.Status.SUBMITTED
        self.layer.save(update_fields=["status"])

        edit_request = LineEditRequest.objects.create(
            requester=self.editor,
            edit_type=EDIT_TYPE_LAYER_UPLOAD,
            geometry=json.loads(self.geom.geojson),
            fields_data={"layer_name": self.layer.name, "layer_id": self.layer.pk},
            layer_upload_feature_id=self.feature.pk,
        )

        self.client.force_login(self.manager)

        def _fake_approve(edit_request):
            from layer_uploader.services import refresh_layer_completion

            feat = Feature.objects.filter(
                pk=edit_request.layer_upload_feature_id
            ).first()
            if feat:
                layer = feat.layer
                feat.delete()
                refresh_layer_completion(layer)
            return 99901.0, "unclassified"

        with patch(
            "mapping.views.approve_layer_upload_edit_request",
            side_effect=_fake_approve,
        ) as approve_mock:
            response = self.client.post(
                reverse(
                    "mapping:approve_request",
                    kwargs={"request_id": edit_request.pk},
                )
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload.get("fclass"), "unclassified")
        self.assertIsNotNone(payload.get("tiles_version"))
        approve_mock.assert_called_once()
        self.assertFalse(LineEditRequest.objects.filter(pk=edit_request.pk).exists())
        self.assertFalse(Feature.objects.filter(pk=self.feature.pk).exists())
        self.layer.refresh_from_db()
        self.assertEqual(self.layer.status, Layer.Status.COMPLETED)

    def test_manager_rejects_layer_upload_via_map_api(self):
        self.feature.status = Feature.Status.AWAITING_MANAGER
        self.feature.save(update_fields=["status"])
        self.layer.status = Layer.Status.SUBMITTED
        self.layer.save(update_fields=["status"])

        edit_request = LineEditRequest.objects.create(
            requester=self.editor,
            edit_type=EDIT_TYPE_LAYER_UPLOAD,
            geometry=json.loads(self.geom.geojson),
            fields_data={"layer_name": self.layer.name},
            layer_upload_feature_id=self.feature.pk,
        )

        self.client.force_login(self.manager)
        response = self.client.post(
            reverse(
                "mapping:reject_request",
                kwargs={"request_id": edit_request.pk},
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        self.assertFalse(LineEditRequest.objects.filter(pk=edit_request.pk).exists())
        self.assertFalse(Feature.objects.filter(pk=self.feature.pk).exists())
        self.layer.refresh_from_db()
        self.assertEqual(self.layer.status, Layer.Status.COMPLETED)

    def test_pending_requests_list_includes_layer_upload(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            edit_type=EDIT_TYPE_LAYER_UPLOAD,
            geometry=json.loads(self.geom.geojson),
            fields_data={"layer_name": "roads_batch"},
            layer_upload_feature_id=self.feature.pk,
        )

        self.client.force_login(self.manager)
        response = self.client.get(reverse("mapping:list_pending_requests"))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["request_category"], "layer_upload")
        self.assertEqual(payload["requests"][0]["request_category_label"], "Layer Upload")
        self.assertEqual(payload["requests"][0]["shapefile_name"], "roads_batch")


class LayerReviewApiTests(TestCase):
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
            status=Layer.Status.DRAFT,
        )
        self.geom = GEOSGeometry("LINESTRING(46.68 24.71, 46.69 24.72)", srid=4326)
        self.staged = Feature.objects.create(
            layer=self.layer,
            geom=self.geom,
            properties={"name": "staged_road"},
            status=Feature.Status.STAGED,
            uploaded_by=self.user,
        )
        self.nominated = Feature.objects.create(
            layer=self.layer,
            geom=GEOSGeometry("LINESTRING(46.69 24.72, 46.70 24.73)", srid=4326),
            properties={"name": "nominated_road"},
            status=Feature.Status.NOMINATED,
            uploaded_by=self.user,
        )

    def test_review_geojson_shows_staged_and_nominated(self):
        response = self.client.get(
            reverse("layer_review_geojson", kwargs={"layer_id": self.layer.pk})
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        ids = {f["id"] for f in payload["features"]}
        self.assertEqual(ids, {self.staged.pk, self.nominated.pk})

    def test_review_table_json_returns_new_status_counts(self):
        response = self.client.get(
            reverse("layer_review_table", kwargs={"layer_id": self.layer.pk})
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["counts"]["staged"], 1)
        self.assertEqual(payload["counts"]["nominated"], 1)


class CrsParsingTests(SimpleTestCase):
    def test_simplify_crs_parses_fiona_epsg_string(self):
        class _EpsgCrs:
            def to_epsg(self):
                return 3857

            def __str__(self):
                return "EPSG:3857"

        name, epsg = simplify_crs(_EpsgCrs())
        self.assertEqual(epsg, "3857")
        self.assertIn("Mercator", name)

    def test_simplify_crs_parses_legacy_wkt(self):
        wkt = 'PROJCS["WGS 84 / Pseudo-Mercator",AUTHORITY["EPSG","3857"]]'
        name, epsg = simplify_crs(wkt)
        self.assertEqual(epsg, "3857")
        self.assertIn("Pseudo-Mercator", name)


class PublishGeometryTests(SimpleTestCase):
    def test_polygon_boundary_converts_to_linestring(self):
        from layer_uploader.services import normalize_geometry_json_for_roads

        square = {
            "type": "Polygon",
            "coordinates": [
                [
                    [46.68, 24.71],
                    [46.69, 24.71],
                    [46.69, 24.72],
                    [46.68, 24.72],
                    [46.68, 24.71],
                ]
            ],
        }
        normalized = normalize_geometry_json_for_roads(square)
        self.assertIn(normalized["type"], ("LineString", "MultiLineString"))
        self.assertTrue(normalized.get("coordinates"))

    def test_prepare_road_fields_defaults_fclass(self):
        from layer_uploader.services import prepare_road_fields_for_publish

        fields = prepare_road_fields_for_publish(properties={})
        self.assertEqual(fields["fclass"], "unclassified")


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
