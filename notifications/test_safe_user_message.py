"""Contract tests mirroring the frontend safeUserMessage technical filter."""

import re
from django.test import SimpleTestCase

# Keep in sync with notifications/static/notifications/js/notifications.js
TECHNICAL_MESSAGE_RE = re.compile(
    "|".join(
        [
            "traceback",
            r"\bexception\b",
            "psycopg",
            "operationalerror",
            "integrityerror",
            "programmingerror",
            "doesnotexist",
            "geosgeometry",
            r"django\.",
            r"at 0x[0-9a-f]+",
            "failed to apply",
            "error saving",
            "error fetching",
            "error approving",
            "error rejecting",
            "error loading",
            "could not update road closure on the network",
            "remote network",
            "internal server error",
            "bad gateway",
            "service unavailable",
            "failed to fetch",
            "networkerror",
            "syntaxerror",
            "typeerror",
            "referenceerror",
            "stack trace",
            r'file ".*", line',
            r"line \d+, in ",
        ]
    ),
    re.I,
)


def looks_technical(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return True
    return bool(TECHNICAL_MESSAGE_RE.search(text))


class SafeUserMessageContractTests(SimpleTestCase):
    def test_blocks_technical_leaks(self):
        samples = [
            "Error saving edit request: relation does not exist",
            "Failed to apply approved edit to remote network: connection refused",
            "psycopg2.OperationalError: FATAL",
            "Traceback (most recent call last):",
            "TypeError: Cannot read properties of null",
            "Failed to fetch",
            "Internal Server Error",
        ]
        for sample in samples:
            self.assertTrue(looks_technical(sample), sample)

    def test_allows_curated_copy(self):
        samples = [
            "Couldn't save. Try again.",
            "This road is waiting for review",
            "Pick a road type",
            "Changes live",
            "Geometry could not be parsed or projected for storage.",
            "Something went wrong. Try again.",
            "تعذّر الحفظ. حاول مرة أخرى.",
            "الطريق بانتظار المراجعة",
        ]
        for sample in samples:
            self.assertFalse(looks_technical(sample), sample)
