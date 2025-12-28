"""
Custom middleware for Content Security Policy
"""
from django.conf import settings


class CSPMiddleware:
    """
    Simple Content Security Policy middleware
    For production, consider using django-csp package
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        
        # Build CSP header
        csp_directives = []
        
        if hasattr(settings, 'CSP_DEFAULT_SRC'):
            csp_directives.append(f"default-src {' '.join(settings.CSP_DEFAULT_SRC)}")
        
        if hasattr(settings, 'CSP_SCRIPT_SRC'):
            csp_directives.append(f"script-src {' '.join(settings.CSP_SCRIPT_SRC)}")
        
        if hasattr(settings, 'CSP_STYLE_SRC'):
            csp_directives.append(f"style-src {' '.join(settings.CSP_STYLE_SRC)}")
        
        if hasattr(settings, 'CSP_FONT_SRC'):
            csp_directives.append(f"font-src {' '.join(settings.CSP_FONT_SRC)}")
        
        if hasattr(settings, 'CSP_IMG_SRC'):
            csp_directives.append(f"img-src {' '.join(settings.CSP_IMG_SRC)}")
        
        if hasattr(settings, 'CSP_CONNECT_SRC'):
            csp_directives.append(f"connect-src {' '.join(settings.CSP_CONNECT_SRC)}")
        
        if hasattr(settings, 'CSP_WORKER_SRC'):
            csp_directives.append(f"worker-src {' '.join(settings.CSP_WORKER_SRC)}")
        
        if csp_directives:
            response['Content-Security-Policy'] = '; '.join(csp_directives)
        
        return response

