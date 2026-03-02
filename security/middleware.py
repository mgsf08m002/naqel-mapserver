from django.utils import timezone


class SessionActivityMiddleware:
    """
    Lightweight middleware to keep basic per-session activity metadata.

    Stores the following keys on the authenticated user's session:
    - session_created_at: ISO timestamp when the session was first seen
    - last_seen_at: ISO timestamp for the most recent request
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)

        if user is not None and user.is_authenticated:
            session = request.session
            now_iso = timezone.now().isoformat()

            if "session_created_at" not in session:
                session["session_created_at"] = now_iso

            session["last_seen_at"] = now_iso

        response = self.get_response(request)
        return response

