from django.test import RequestFactory, SimpleTestCase

from config.api_errors import client_message, json_api_error, json_detail_error


class ApiErrorsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_json_api_error_hides_exception_text(self):
        request = self.factory.get("/")
        request.ui_language = "en"
        response = json_api_error(
            request,
            exc=RuntimeError("psycopg2.OperationalError: secret db detail"),
            status=500,
            message_key="generic_error",
        )
        self.assertEqual(response.status_code, 500)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertNotIn("psycopg", payload["message"].lower())
        self.assertNotIn("secret", payload["message"].lower())
        self.assertIn("try again", payload["message"].lower())

    def test_json_api_error_arabic(self):
        request = self.factory.get("/")
        request.ui_language = "ar"
        response = json_api_error(
            request,
            exc=Exception("Traceback (most recent call last)"),
            status=500,
        )
        payload = response.json()
        self.assertEqual(payload["message"], client_message(request, "generic_error"))
        self.assertNotIn("Traceback", payload["message"])

    def test_json_detail_error_hides_exception_text(self):
        request = self.factory.get("/")
        request.ui_language = "en"
        response = json_detail_error(
            request,
            exc=ValueError("should not appear for unexpected path"),
            status=500,
        )
        # Unexpected path uses message_key, not str(exc)
        payload = response.json()
        self.assertNotIn("should not appear", payload["detail"])

    def test_mapping_toast_key_resolves(self):
        request = self.factory.get("/")
        request.ui_language = "en"
        response = json_api_error(
            request,
            status=500,
            message_key="toast_couldnt_save",
            log=False,
        )
        self.assertEqual(response.json()["message"], "Couldn't save. Try again.")

    def test_search_unavailable_key_en_ar(self):
        req_en = self.factory.get("/")
        req_en.ui_language = "en"
        req_ar = self.factory.get("/")
        req_ar.ui_language = "ar"
        en = json_api_error(
            req_en,
            status=500,
            message_key="toast_search_unavailable",
            log=False,
            extra={"results": []},
        ).json()
        ar = json_api_error(
            req_ar,
            status=500,
            message_key="toast_search_unavailable",
            log=False,
            extra={"results": []},
        ).json()
        self.assertEqual(en["message"], "Search is temporarily unavailable")
        self.assertEqual(ar["message"], "البحث غير متاح مؤقتًا")
        self.assertEqual(en["results"], [])
        self.assertNotEqual(en["message"], ar["message"])
