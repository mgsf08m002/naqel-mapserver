import json
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import GEOSGeometry
from django.test import Client, RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from mapping.models import LineEditRequest
from mapping.riyadh_network import riyadh_tile_proxy_absolute_url, tiles_version_ms
from system_admin.models import UserProfile


class RiyadhNetworkUtilTests(SimpleTestCase):
    def test_tiles_version_ms_increases(self):
        first = tiles_version_ms()
        second = tiles_version_ms()
        self.assertGreaterEqual(second, first)

    @override_settings(RIYADH_ROADS_TILE_URL="http://example.com/tiles/{z}/{x}/{y}")
    def test_tile_proxy_url_when_upstream_configured(self):
        request = RequestFactory().get("/")
        request.META["HTTP_HOST"] = "localhost:8000"
        url = riyadh_tile_proxy_absolute_url(request)
        self.assertIn("/mapping/tiles/riyadh_roads/", url)
        self.assertIn("{z}", url)

    @override_settings(RIYADH_ROADS_TILE_URL="")
    def test_tile_proxy_url_empty_when_upstream_missing(self):
        request = RequestFactory().get("/")
        self.assertEqual(riyadh_tile_proxy_absolute_url(request), "")


class RiyadhRoadsTileProxyTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="tile_user",
            email="tile@example.com",
            password="testpass123",
        )
        self.client = Client()
        self.client.force_login(self.user)

    @override_settings(
        RIYADH_ROADS_TILE_URL="http://martin.test/riyadh_roads/{z}/{x}/{y}",
        RIYADH_ROADS_TILE_PROXY_CACHE_MAX_AGE=0,
    )
    @patch("mapping.views.urlopen")
    def test_empty_tile_returns_204_with_no_store(self, urlopen_mock):
        resp = MagicMock()
        resp.status = 204
        resp.read.return_value = b""
        resp.headers = {}
        urlopen_mock.return_value.__enter__.return_value = resp

        response = self.client.get("/mapping/tiles/riyadh_roads/14/1/2/?v=123")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        self.assertIn("no-store", response["Cache-Control"])

    @override_settings(
        RIYADH_ROADS_TILE_URL="http://martin.test/riyadh_roads/{z}/{x}/{y}",
        RIYADH_ROADS_TILE_PROXY_CACHE_MAX_AGE=0,
    )
    @patch("mapping.views.urlopen")
    def test_non_empty_tile_forwards_body(self, urlopen_mock):
        body = b"\x1a\x00protobuf-bytes"
        resp = MagicMock()
        resp.status = 200
        resp.read.return_value = body
        resp.headers = {"Content-Type": "application/x-protobuf"}
        urlopen_mock.return_value.__enter__.return_value = resp

        response = self.client.get("/mapping/tiles/riyadh_roads/10/5/6/?v=999")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, body)
        self.assertIn("no-store", response["Cache-Control"])


class DeleteRequestApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.manager = user_model.objects.create_user(
            username="del_mgr",
            email="del_mgr@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.manager,
            role="manager",
            password_setup_completed=True,
        )
        self.client.force_login(self.manager)
        self.geom = GEOSGeometry("LINESTRING(46.68 24.71, 46.69 24.72)", srid=4326)

    @patch("mapping.views._apply_delete_to_base_network")
    @patch("mapping.views._resolve_riyadh_road")
    @patch("mapping.views._get_riyadh_road_geometry_wgs84")
    def test_manager_delete_returns_tiles_version_and_deleted_id(
        self, geom_mock, resolve_mock, apply_mock
    ):
        resolve_mock.return_value = object()
        geom_mock.return_value = json.loads(self.geom.geojson)

        response = self.client.post(
            reverse("mapping:create_delete_request"),
            data=json.dumps(
                {
                    "target_type": "riyadh_road",
                    "target_id": 108801,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertTrue(payload["auto_approved"])
        self.assertEqual(payload["deleted_road_id"], 108801)
        self.assertIsNotNone(payload.get("tiles_version"))
        apply_mock.assert_called_once()

    @patch("mapping.views._apply_delete_to_base_network")
    @patch("mapping.views._resolve_riyadh_road")
    @patch("mapping.views._get_riyadh_road_geometry_wgs84")
    def test_approve_delete_request_returns_tiles_version(
        self, geom_mock, resolve_mock, apply_mock
    ):
        resolve_mock.return_value = object()
        geom_mock.return_value = json.loads(self.geom.geojson)

        edit_request = LineEditRequest.objects.create(
            requester=self.manager,
            edit_type="DELETE",
            geometry=json.loads(self.geom.geojson),
            is_riyadh_road=True,
            riyadh_road_id=108801,
        )

        response = self.client.post(
            reverse(
                "mapping:approve_request",
                kwargs={"request_id": edit_request.pk},
            )
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["deleted_road_id"], 108801)
        self.assertIsNotNone(payload.get("tiles_version"))
        apply_mock.assert_called_once()
