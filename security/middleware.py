from django.utils import timezone

# Nginx auth_request calls this once per map tile. Writing the session there would
# turn every tile into a session-table UPDATE.
ACTIVITY_EXEMPT_PREFIXES = ("/tiles-auth/",)


class SessionActivityMiddleware:
    """Track basic per-session activity timestamps for authenticated users."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)

        if (
            user is not None
            and user.is_authenticated
            and not request.path.startswith(ACTIVITY_EXEMPT_PREFIXES)
        ):
            session = request.session
            now_iso = timezone.now().isoformat()

            if "session_created_at" not in session:
                session["session_created_at"] = now_iso

            session["last_seen_at"] = now_iso

        response = self.get_response(request)
        return response
