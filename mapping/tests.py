import json
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import GEOSGeometry
from django.test import Client, RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from mapping.approval_api import (
    serialize_manager_review_history_item,
    serialize_my_edit_request_item,
)
from mapping.approval_categories import (
    EDIT_TYPE_DELETE,
    classify_approval_request,
    create_pending_road_edit_request,
)
from mapping.models import LineEditRequest
from mapping.riyadh_network import (
    network_mutation_payload,
    normalize_published_fclass,
    published_fclass_from_edit_request,
    riyadh_tile_proxy_absolute_url,
    tiles_version_ms,
)
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

    def test_normalize_published_fclass_defaults_unclassified(self):
        self.assertEqual(normalize_published_fclass(""), "unclassified")
        self.assertEqual(normalize_published_fclass("Primary"), "primary")

    def test_network_mutation_payload_includes_tiles_version(self):
        payload = network_mutation_payload(remote_road_id=42, fclass="primary")
        self.assertIn("tiles_version", payload)
        self.assertEqual(payload["remote_road_id"], 42)
        self.assertEqual(payload["fclass"], "primary")

    def test_published_fclass_from_edit_request_uses_label(self):
        request = MagicMock()
        request.fields_data = {}
        request.current_feature_label = "Primary Road"
        request.feature_type = "Primary Road"
        self.assertEqual(published_fclass_from_edit_request(request), "primary")


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
        edit_request.refresh_from_db()
        self.assertEqual(edit_request.status, "approved")
        self.assertIsNone(edit_request.published_road_id)
        self.assertTrue(LineEditRequest.objects.filter(pk=edit_request.pk).exists())

    @patch("mapping.views._apply_delete_to_base_network")
    @patch("mapping.views._resolve_riyadh_road")
    @patch("mapping.views._get_riyadh_road_geometry_wgs84")
    def test_manager_auto_delete_keeps_history_row(
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
        req = LineEditRequest.objects.get()
        self.assertEqual(req.status, "approved")
        self.assertIsNone(req.published_road_id)


class ApprovalCategoryTests(TestCase):
    def test_classify_layer_upload(self):
        req = LineEditRequest(
            edit_type="Layer Upload",
            layer_upload_feature_id=1,
            fields_data={"layer_name": "batch.zip"},
        )
        result = classify_approval_request(req)
        self.assertEqual(result["key"], "layer_upload")

    def test_classify_delete_road(self):
        req = LineEditRequest(
            edit_type="DELETE",
            request_category="delete_road",
            is_riyadh_road=True,
            riyadh_road_id=1,
        )
        result = classify_approval_request(req)
        self.assertEqual(result["key"], "delete_road")

    def test_is_delete_road_request_by_category(self):
        from mapping.approval_categories import is_delete_road_request

        req = LineEditRequest(request_category="delete_road", is_riyadh_road=True, riyadh_road_id=1)
        self.assertTrue(is_delete_road_request(req))

    def test_classify_new_road(self):
        req = LineEditRequest(is_riyadh_road=False, riyadh_road_id=None)
        result = classify_approval_request(req)
        self.assertEqual(result["key"], "new_road")

    def test_classify_add_road_label(self):
        road = MagicMock()
        road.name = ""
        road.fclass = "motorway"
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            current_feature_label="Motorway",
            fields_data={"name": "King Fahd Rd"},
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "add_road_label")

    def test_classify_change_road_label(self):
        road = MagicMock()
        road.name = "Old Name"
        road.fclass = "motorway"
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            current_feature_label="Motorway",
            fields_data={"name": "New Name"},
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "change_road_label")

    def test_classify_new_feature_type(self):
        road = MagicMock()
        road.name = "Main St"
        road.fclass = "motorway"
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            current_feature_label="Primary Road",
            fields_data={"name": "Main St", "fclass": "primary"},
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "new_feature_type")
        self.assertEqual(result["label"], "New Feature Type")

    def test_classify_new_road_geometry(self):
        road = MagicMock()
        road.name = "Main St"
        road.fclass = "motorway"
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            geometry_changed=True,
            current_feature_label="Motorway",
            fields_data={"name": "Main St", "fclass": "motorway"},
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "new_road_geometry")
        self.assertEqual(result["label"], "New Road Geometry")

    def test_classify_geometry_reshape_not_attribute_edit(self):
        """Shape-only edits must not be labeled Road Attribute Edit."""
        road = MagicMock()
        road.name = "Main St"
        road.fclass = "motorway"
        road.ref = "R-1"
        road.oneway = "yes"
        road.maxspeed = 60
        road.osm_id = "123"
        road.code = 1
        road.bridge = "no"
        road.tunnel = "no"
        road.layer = 0
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            geometry_changed=True,
            request_category="road_attribute_edit",
            current_feature_label="Motorway",
            fields_data={
                "name": "Main St",
                "fclass": "motorway",
                "ref": "R-1",
                "oneway": "yes",
                "maxspeed": 60,
                "osm_id": "123",
                "code": 1,
                "bridge": "no",
                "tunnel": "no",
                "layer": 0,
            },
            tags_data=[],
            relations_data=[],
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "new_road_geometry")

    def test_classify_geometry_from_stored_geometries(self):
        road = MagicMock()
        road.name = "Main St"
        road.fclass = "motorway"
        road.ref = ""
        road.oneway = ""
        road.maxspeed = None
        road.osm_id = ""
        road.code = None
        road.bridge = ""
        road.tunnel = ""
        road.layer = None
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            geometry_changed=False,
            geometry={"type": "LineString", "coordinates": [[0, 0], [2, 2]]},
            original_geometry={"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            current_feature_label="Motorway",
            fields_data={"name": "Main St", "fclass": "motorway"},
            tags_data=[],
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "new_road_geometry")

    def test_resolve_ignores_stale_stored_category(self):
        from mapping.approval_categories import resolve_request_category_key

        road = MagicMock()
        road.name = "Main St"
        road.fclass = "motorway"
        road.ref = ""
        road.oneway = ""
        road.maxspeed = None
        road.osm_id = ""
        road.code = None
        road.bridge = ""
        road.tunnel = ""
        road.layer = None
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            geometry_changed=True,
            request_category="road_attribute_edit",
            current_feature_label="Motorway",
            fields_data={"name": "Main St", "fclass": "motorway"},
            tags_data=[],
        )
        self.assertEqual(resolve_request_category_key(req, road=road), "new_road_geometry")

    def test_classify_road_attribute_edit(self):
        road = MagicMock()
        road.name = "Main St"
        road.fclass = "motorway"
        road.ref = "old"
        road.oneway = ""
        road.maxspeed = None
        road.osm_id = ""
        road.code = None
        road.bridge = ""
        road.tunnel = ""
        road.layer = None
        req = LineEditRequest(
            is_riyadh_road=True,
            riyadh_road_id=1,
            current_feature_label="Motorway",
            fields_data={"name": "Main St", "fclass": "motorway", "ref": "new-ref"},
            tags_data=[],
            relations_data=[],
        )
        result = classify_approval_request(req, road=road)
        self.assertEqual(result["key"], "road_attribute_edit")

    def test_create_pending_stores_request_category(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="cat_user",
            email="cat@example.com",
            password="testpass123",
        )
        road = MagicMock()
        road.name = ""
        road.fclass = "motorway"
        req = create_pending_road_edit_request(
            requester=user,
            is_riyadh_road=True,
            riyadh_road_id=1,
            geometry={"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            current_feature_label="Motorway",
            fields_data={"name": "New Label"},
        )
        self.assertEqual(req.request_category, "add_road_label")


class RiyadhRoadSearchApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="search_user",
            email="search@example.com",
            password="testpass123",
        )
        self.client = Client()
        self.client.force_login(self.user)

    def test_search_requires_minimum_query_length(self):
        response = self.client.get(reverse("mapping:riyadh_road_search"), {"q": "a"})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])

    def test_search_requires_login(self):
        anon = Client()
        response = anon.get(reverse("mapping:riyadh_road_search"), {"q": "king"})
        self.assertEqual(response.status_code, 302)

    @patch("mapping.views.connections")
    def test_search_returns_results(self, mock_connections):
        geometry = json.dumps(
            {"type": "LineString", "coordinates": [[46.7, 24.7], [46.71, 24.71]]}
        )
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            (42, "King Fahd Road", "طريق الملك فهد", "King Fahd Road", geometry, 0),
        ]
        mock_connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = (
            cursor
        )

        response = self.client.get(reverse("mapping:riyadh_road_search"), {"q": "King"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(payload["results"][0]["id"], 42)
        self.assertEqual(payload["results"][0]["display_name"], "King Fahd Road")
        self.assertEqual(payload["results"][0]["name_en"], "King Fahd Road")
        self.assertEqual(payload["results"][0]["name_ar"], "طريق الملك فهد")
        self.assertNotIn("query", payload)
        self.assertEqual(payload["results"][0]["geometry"]["type"], "LineString")


class MyEditsApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.editor = user_model.objects.create_user(
            username="edits_editor",
            email="edits_editor@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.editor,
            role="editor",
            password_setup_completed=True,
            can_access_my_edits=True,
        )
        self.denied_editor = user_model.objects.create_user(
            username="edits_denied",
            email="edits_denied@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.denied_editor,
            role="editor",
            password_setup_completed=True,
            can_access_my_edits=False,
        )
        self.manager = user_model.objects.create_user(
            username="edits_mgr",
            email="edits_mgr@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.manager,
            role="manager",
            password_setup_completed=True,
            can_access_my_edits=True,
        )
        self.client = Client()
        self.geom = {"type": "LineString", "coordinates": [[46.68, 24.71], [46.69, 24.72]]}

    def test_list_requires_my_edits_permission(self):
        self.client.force_login(self.denied_editor)
        response = self.client.get(reverse("mapping:list_my_edit_requests"))
        self.assertEqual(response.status_code, 403)

    def test_list_returns_only_requester_rows(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="pending",
            request_category="new_road",
            current_feature_label="Primary Road",
            fields_data={"name": "Test Rd"},
        )
        LineEditRequest.objects.create(
            requester=self.manager,
            geometry=self.geom,
            status="approved",
            request_category="new_road_geometry",
            published_road_id=42,
            reviewed_by=self.manager,
            is_riyadh_road=True,
            riyadh_road_id=42,
        )

        self.client.force_login(self.editor)
        response = self.client.get(reverse("mapping:list_my_edit_requests"))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["status"], "pending")

    def test_my_edits_category_filter(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="layer_upload",
            reviewed_by=self.manager,
            fields_data={"layer_name": "roads.zip"},
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="pending",
            request_category="new_road",
        )
        self.client.force_login(self.editor)
        response = self.client.get(
            reverse("mapping:list_my_edit_requests"),
            {"category": "layer_upload"},
        )
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["request_category"], "layer_upload")

    def test_my_edits_date_filter(self):
        from datetime import datetime

        from django.utils import timezone

        older = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        newer = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="pending",
            request_category="delete_road",
        )
        LineEditRequest.objects.filter(pk=older.pk).update(
            created_at=timezone.make_aware(datetime(2026, 5, 1, 10, 0))
        )
        LineEditRequest.objects.filter(pk=newer.pk).update(
            created_at=timezone.make_aware(datetime(2026, 6, 5, 10, 0))
        )

        self.client.force_login(self.editor)
        response = self.client.get(
            reverse("mapping:list_my_edit_requests"),
            {"start_date": "2026-06-01", "end_date": "2026-06-30"},
        )
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["request_category"], "delete_road")

    def test_my_edits_multi_category_filter(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="layer_upload",
            reviewed_by=self.manager,
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="pending",
            request_category="new_road",
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="rejected",
            request_category="delete_road",
            reviewed_by=self.manager,
        )
        self.client.force_login(self.editor)
        response = self.client.get(
            reverse("mapping:list_my_edit_requests"),
            [("category", "layer_upload"), ("category", "delete_road")],
        )
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["requests"]), 2)
        categories = {row["request_category"] for row in payload["requests"]}
        self.assertEqual(categories, {"layer_upload", "delete_road"})

    def test_serialize_approved_non_delete_can_open_map(self):
        user_model = get_user_model()
        reviewer = user_model.objects.create_user(
            username="rev_user",
            email="rev@example.com",
            password="testpass123",
        )
        req = LineEditRequest.objects.create(
            requester=self.editor,
            status="approved",
            request_category="new_road_geometry",
            published_road_id=108801,
            is_riyadh_road=True,
            riyadh_road_id=108801,
            geometry=self.geom,
            reviewed_by=reviewer,
        )
        item = serialize_my_edit_request_item(req)
        self.assertTrue(item["can_open_on_map"])
        self.assertEqual(item["map_road_id"], 108801)
        self.assertEqual(item["reviewer"]["username"], "rev_user")

    def test_serialize_approved_delete_cannot_open_map(self):
        req = LineEditRequest.objects.create(
            requester=self.editor,
            status="approved",
            edit_type=EDIT_TYPE_DELETE,
            request_category="delete_road",
            geometry=self.geom,
            is_riyadh_road=True,
            riyadh_road_id=99,
        )
        item = serialize_my_edit_request_item(req)
        self.assertFalse(item["can_open_on_map"])
        self.assertIsNone(item["map_road_id"])

    @patch("mapping.views._apply_riyadh_edit_to_base_network")
    @patch("mapping.views._resolve_riyadh_road")
    def test_approve_riyadh_edit_retains_row_with_published_id(
        self, resolve_mock, apply_mock
    ):
        resolve_mock.return_value = object()
        edit_request = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="pending",
            is_riyadh_road=True,
            riyadh_road_id=555,
            current_feature_label="Motorway",
            fields_data={"name": "Main", "fclass": "motorway"},
        )
        self.client.force_login(self.manager)
        response = self.client.post(
            reverse(
                "mapping:approve_request",
                kwargs={"request_id": edit_request.pk},
            )
        )
        self.assertEqual(response.status_code, 200)
        edit_request.refresh_from_db()
        self.assertEqual(edit_request.status, "approved")
        self.assertEqual(edit_request.published_road_id, 555)
        self.assertEqual(edit_request.reviewed_by_id, self.manager.pk)


class ManagerReviewHistoryApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.editor = user_model.objects.create_user(
            username="rh_editor",
            email="rh_editor@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.editor,
            role="editor",
            password_setup_completed=True,
        )
        self.manager = user_model.objects.create_user(
            username="rh_mgr",
            email="rh_mgr@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.manager,
            role="manager",
            password_setup_completed=True,
        )
        self.other_manager = user_model.objects.create_user(
            username="rh_mgr2",
            email="rh_mgr2@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(
            user=self.other_manager,
            role="manager",
            password_setup_completed=True,
        )
        self.client = Client()
        self.geom = {"type": "LineString", "coordinates": [[46.68, 24.71], [46.69, 24.72]]}

    def test_non_manager_forbidden(self):
        self.client.force_login(self.editor)
        response = self.client.get(reverse("mapping:list_manager_review_history"))
        self.assertEqual(response.status_code, 403)

    def test_excludes_manager_requester_rows(self):
        LineEditRequest.objects.create(
            requester=self.manager,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        self.client.force_login(self.manager)
        response = self.client.get(reverse("mapping:list_manager_review_history"))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["requester"]["username"], "rh_editor")

    def test_includes_superuser_requester_rows(self):
        user_model = get_user_model()
        admin = user_model.objects.create_user(
            username="rh_admin",
            email="rh_admin@example.com",
            password="testpass123",
            is_superuser=True,
        )
        UserProfile.objects.create(user=admin, role=None)
        LineEditRequest.objects.create(
            requester=admin,
            geometry=self.geom,
            status="approved",
            request_category="new_road_geometry",
            geometry_changed=True,
            reviewed_by=self.manager,
            published_road_id=108799,
        )
        self.client.force_login(self.manager)
        response = self.client.get(reverse("mapping:list_manager_review_history"))
        payload = response.json()
        self.assertTrue(payload["success"])
        usernames = [r["requester"]["username"] for r in payload["requests"]]
        self.assertIn("rh_admin", usernames)

    def test_scope_mine_filters_by_reviewer(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="rejected",
            request_category="delete_road",
            reviewed_by=self.other_manager,
        )
        self.client.force_login(self.manager)
        response = self.client.get(
            reverse("mapping:list_manager_review_history"),
            {"scope": "mine"},
        )
        payload = response.json()
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["status"], "approved")

    def test_status_filter(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        rejected_row = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="rejected",
            request_category="new_road_geometry",
            reviewed_by=self.manager,
            fields_data={"name": "StatusFilterMarker"},
        )
        self.client.force_login(self.manager)
        response = self.client.get(
            reverse("mapping:list_manager_review_history"),
            {"status": "rejected"},
        )
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertTrue(all(r["status"] == "rejected" for r in payload["requests"]))
        ids = [r["id"] for r in payload["requests"]]
        self.assertIn(rejected_row.id, ids)

    def test_category_filter(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="layer_upload",
            reviewed_by=self.manager,
            fields_data={"layer_name": "batch.zip"},
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        self.client.force_login(self.manager)
        response = self.client.get(
            reverse("mapping:list_manager_review_history"),
            {"category": "layer_upload"},
        )
        payload = response.json()
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["request_category"], "layer_upload")

    def test_multi_category_filter(self):
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="layer_upload",
            reviewed_by=self.manager,
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="rejected",
            request_category="delete_road",
            reviewed_by=self.manager,
        )
        LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        self.client.force_login(self.manager)
        response = self.client.get(
            reverse("mapping:list_manager_review_history"),
            [("category", "layer_upload"), ("category", "delete_road")],
        )
        payload = response.json()
        self.assertEqual(len(payload["requests"]), 2)
        categories = {row["request_category"] for row in payload["requests"]}
        self.assertEqual(categories, {"layer_upload", "delete_road"})

    def test_date_filter(self):
        from datetime import datetime

        from django.utils import timezone

        older = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road",
            reviewed_by=self.manager,
        )
        newer = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="rejected",
            request_category="delete_road",
            reviewed_by=self.manager,
        )
        LineEditRequest.objects.filter(pk=older.pk).update(
            created_at=timezone.make_aware(datetime(2026, 5, 1, 10, 0))
        )
        LineEditRequest.objects.filter(pk=newer.pk).update(
            created_at=timezone.make_aware(datetime(2026, 6, 5, 10, 0))
        )

        self.client.force_login(self.manager)
        response = self.client.get(
            reverse("mapping:list_manager_review_history"),
            {"start_date": "2026-06-01", "end_date": "2026-06-30"},
        )
        payload = response.json()
        self.assertEqual(len(payload["requests"]), 1)
        self.assertEqual(payload["requests"][0]["request_category"], "delete_road")

    def test_serializer_includes_requester_and_map_link(self):
        req = LineEditRequest.objects.create(
            requester=self.editor,
            geometry=self.geom,
            status="approved",
            request_category="new_road_geometry",
            published_road_id=42,
            is_riyadh_road=True,
            riyadh_road_id=42,
            reviewed_by=self.manager,
        )
        item = serialize_manager_review_history_item(req)
        self.assertEqual(item["requester"]["username"], "rh_editor")
        self.assertTrue(item["can_open_on_map"])
        self.assertEqual(item["map_road_id"], 42)
