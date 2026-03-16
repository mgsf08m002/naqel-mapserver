import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from system_admin.models import UserProfile

from .models import LineEditRequest
class DeleteRoadRequestFlowTests(TestCase):
    def setUp(self):
        self.client = Client()

        self.editor = User.objects.create_user(username="editor", password="pass1234")
        UserProfile.objects.create(user=self.editor, role="editor")

        self.manager = User.objects.create_user(username="manager", password="pass1234")
        UserProfile.objects.create(user=self.manager, role="manager")

        self.approved_line = LineEditRequest.objects.create(
            requester=self.editor,
            status="approved",
            edit_type="LINE EDIT",
            geometry={
                "type": "LineString",
                "coordinates": [
                    [46.0, 24.0],
                    [46.1, 24.1],
                ],
            },
            feature_type="Line",
            current_feature_label="Line",
            fields_data={"name": "Test Road"},
            tags_data=[],
            relations_data=[],
            is_riyadh_road=False,
        )

    def test_editor_creates_pending_delete_request_for_approved_line(self):
        self.client.login(username="editor", password="pass1234")

        resp = self.client.post(
            "/mapping/api/request/delete/",
            data=json.dumps(
                {
                    "target_type": "approved_line",
                    "target_id": self.approved_line.id,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload.get("success"))
        self.assertFalse(payload.get("auto_approved"))

        delete_req = LineEditRequest.objects.get(pk=payload["request_id"])
        self.assertEqual(delete_req.status, "pending")
        self.assertEqual((delete_req.edit_type or "").upper(), "DELETE")
        self.assertEqual(delete_req.parent_approved_line_id, self.approved_line.id)
        self.assertTrue(LineEditRequest.objects.filter(pk=self.approved_line.id).exists())

    def test_manager_auto_approves_and_deletes_approved_line(self):
        self.client.login(username="manager", password="pass1234")

        resp = self.client.post(
            "/mapping/api/request/delete/",
            data=json.dumps(
                {
                    "target_type": "approved_line",
                    "target_id": self.approved_line.id,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload.get("success"))
        self.assertTrue(payload.get("auto_approved"))

        self.assertFalse(LineEditRequest.objects.filter(pk=self.approved_line.id).exists())

    def test_manager_approval_deletes_target_line(self):
        # Editor submits pending delete request
        self.client.login(username="editor", password="pass1234")
        resp = self.client.post(
            "/mapping/api/request/delete/",
            data=json.dumps(
                {
                    "target_type": "approved_line",
                    "target_id": self.approved_line.id,
                }
            ),
            content_type="application/json",
        )
        payload = resp.json()
        delete_request_id = payload["request_id"]
        self.client.logout()

        # Manager approves it
        self.client.login(username="manager", password="pass1234")
        approve_resp = self.client.post(f"/mapping/api/request/{delete_request_id}/approve/")
        self.assertEqual(approve_resp.status_code, 200)
        approve_payload = approve_resp.json()
        self.assertTrue(approve_payload.get("success"))

        self.assertFalse(LineEditRequest.objects.filter(pk=self.approved_line.id).exists())
        delete_req = LineEditRequest.objects.get(pk=delete_request_id)
        self.assertEqual(delete_req.status, "approved")


class DeletedRiyadhRoadsEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username="user", password="pass1234")
        UserProfile.objects.create(user=self.user, role="editor")

        self.delete_req = LineEditRequest.objects.create(
            requester=self.user,
            status="approved",
            edit_type="DELETE",
            geometry={
                "type": "LineString",
                "coordinates": [
                    [46.0, 24.0],
                    [46.1, 24.1],
                ],
            },
            feature_type="Line",
            current_feature_label="Line",
            fields_data={},
            tags_data=[],
            relations_data=[],
            is_riyadh_road=True,
            riyadh_road_id=123,
        )

    def test_deleted_riyadh_roads_endpoint_returns_ids(self):
        resp = self.client.get("/mapping/api/riyadh-roads/deleted/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("success"))
        self.assertIn(123, data.get("deleted_ids", []))




