from django.test import SimpleTestCase

from notifications.templatetags.notify_extras import (
    django_tags_to_notify_type,
    messages_notify_json,
)


class _Msg:
    def __init__(self, text, tags):
        self.tags = tags
        self._text = text

    def __str__(self):
        return self._text


class NotifyExtrasTests(SimpleTestCase):
    def test_django_tags_combined(self):
        self.assertEqual(django_tags_to_notify_type("error debug"), "error")
        self.assertEqual(django_tags_to_notify_type("success"), "success")
        self.assertEqual(django_tags_to_notify_type(""), "info")

    def test_messages_notify_json_empty(self):
        self.assertEqual(messages_notify_json([]), "[]")

    def test_messages_notify_json_serializes(self):
        raw = messages_notify_json(
            [_Msg("Hello", "success"), _Msg("Oops", "error")]
        )
        self.assertIn("Hello", raw)
        self.assertIn("success", raw)
        self.assertIn("error", raw)
