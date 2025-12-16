from django.shortcuts import render


def map_view(request):
    """KSA Map Editing Module view."""
    return render(request, 'mapping/map.html')
