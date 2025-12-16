from django.shortcuts import render


def landing_view(request):
    """Landing page view with map."""
    return render(request, 'home/landing.html')
