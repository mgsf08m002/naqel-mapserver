from django.test import RequestFactory, SimpleTestCase, override_settings

from home import error_views


class ErrorViewsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _request(self, path="/missing/", lang="en"):
        request = self.factory.get(path)
        request.ui_language = lang
        request.ui_dir = "rtl" if lang == "ar" else "ltr"
        return request

    def test_404_english(self):
        response = error_views.page_not_found(self._request(lang="en"))
        self.assertEqual(response.status_code, 404)
        body = response.content.decode("utf-8")
        self.assertIn("Page not found", body)
        self.assertIn("geotrak-logo-en.png", body)
        self.assertIn('lang="en"', body)
        self.assertIn('dir="ltr"', body)

    def test_404_arabic_logo_and_copy(self):
        response = error_views.page_not_found(self._request(lang="ar"))
        self.assertEqual(response.status_code, 404)
        body = response.content.decode("utf-8")
        self.assertIn("الصفحة غير موجودة", body)
        self.assertIn("geotrak-logo-ar.png", body)
        self.assertIn('lang="ar"', body)
        self.assertIn('dir="rtl"', body)

    def test_status_codes(self):
        self.assertEqual(error_views.bad_request(self._request()).status_code, 400)
        self.assertEqual(error_views.permission_denied(self._request()).status_code, 403)
        self.assertEqual(error_views.server_error(self._request()).status_code, 500)
        self.assertEqual(error_views.csrf_failure(self._request()).status_code, 403)

    @override_settings(ROOT_URLCONF="config.urls")
    def test_handlers_wired(self):
        from django.conf import settings
        from django.urls import get_resolver

        resolver = get_resolver()
        self.assertTrue(callable(resolver.resolve_error_handler(404)))
        self.assertEqual(settings.CSRF_FAILURE_VIEW, "home.error_views.csrf_failure")
