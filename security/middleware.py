from security.session_meta import touch_session_activity

# Nginx auth_request calls this once per map tile. Writing the session there would
# turn every tile into a session-table UPDATE.
ACTIVITY_EXEMPT_PREFIXES = ("/tiles-auth/",)


class SessionActivityMiddleware:
    """Track per-session activity and identity metadata for authenticated users."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)

        if (
            user is not None
            and user.is_authenticated
            and not request.path.startswith(ACTIVITY_EXEMPT_PREFIXES)
        ):
            touch_session_activity(request)

        response = self.get_response(request)
        return response
