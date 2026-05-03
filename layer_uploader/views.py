import os, zipfile, tempfile
from collections import defaultdict
from django.shortcuts import render, redirect
from .utils import simplify_crs
REQUIRED_EXTENSIONS = {'.shp', '.shx', '.dbf'}
from django.contrib.auth.decorators import login_required

@login_required
def upload_view(request):
    context = {}

    if request.method == "POST":

        # If user already selected a shapefile → go to validate
        if "selected" in request.POST:
            request.session['selected'] = request.POST.get("selected")
            return redirect('validate')

        # Step 1: Upload + detect
        files = request.FILES.getlist('files')
        temp_dir = tempfile.mkdtemp()

        for f in files:
            path = os.path.join(temp_dir, f.name)

            with open(path, 'wb+') as dest:
                for chunk in f.chunks():
                    dest.write(chunk)

            if f.name.endswith('.zip'):
                with zipfile.ZipFile(path, 'r') as zip_ref:
                    zip_ref.extractall(temp_dir)

        grouped = defaultdict(set)

        for root, _, filenames in os.walk(temp_dir):
            for file in filenames:
                base, ext = os.path.splitext(file)
                grouped[base].add(ext.lower())

        valid_sets = [
            base for base, exts in grouped.items()
            if REQUIRED_EXTENSIONS.issubset(exts)
        ]

        if not valid_sets:
            context["error"] = "No valid shapefile found."
            return render(request, "layer_uploader/upload.html", context)

        request.session['temp_dir'] = temp_dir

        # 🔥 Extract metadata for each shapefile
        shapefile_info = []

        for base in valid_sets:
            shp_path = None

            for root, _, files in os.walk(temp_dir):
                for f in files:
                    if f.startswith(base) and f.endswith('.shp'):
                        shp_path = os.path.join(root, f)

            if shp_path:
                try:
                    with fiona.open(shp_path) as src:
                        crs = src.crs
                        count = len(src)

                        # ✅ NEW: simplified CRS handling
                        crs_name, epsg = simplify_crs(crs)

                        shapefile_info.append({
                            "name": base,
                            "crs_name": crs_name,
                            "epsg": epsg if epsg else "Not defined",
                            "count": count
                        })

                except Exception as e:
                    shapefile_info.append({
                        "name": base,
                        "error": str(e)
                    })

        context["shapefiles"] = shapefile_info

    return render(request, "layer_uploader/upload.html", context)

def select_view(request):
    if request.method == "POST":
        request.session['selected'] = request.POST.get("selected")
        return redirect('validate')

    return render(request, "layer_uploader/select_shapefile.html", {
        "options": request.session.get('options', [])
    })


import fiona
from django.contrib.gis.geos import GEOSGeometry
from .models import Layer

def validate_view(request):
    temp_dir = request.session.get('temp_dir')
    selected = request.session.get('selected')

    shp_path = None

    # 🔍 Find shapefile
    for root, _, files in os.walk(temp_dir):
        for f in files:
            if f.startswith(selected) and f.endswith('.shp'):
                shp_path = os.path.join(root, f)

    if not shp_path:
        return render(request, "layer_uploader/upload.html", {
            "error": "Shapefile not found."
        })

    # 📊 Read metadata
    with fiona.open(shp_path) as src:
        feature_count = len(src)
        crs = src.crs

        # ✅ FIX: Use helper instead of manual SRID parsing
        crs_name, epsg = simplify_crs(crs)

    # 💾 Save layer
    if request.method == "POST":
        Layer.objects.create(
            name=selected,
            uploaded_by=request.user,
            srid=epsg,  # ✅ correct SRID
            total_features=feature_count,
            new_features=feature_count
        )

        return redirect('success')

    # 🎨 Send clean data to template
    return render(request, "layer_uploader/validate.html", {
        "name": selected,
        "count": feature_count,
        "crs_name": crs_name,
        "epsg": epsg if epsg else "Not defined"
    })


def success_view(request):
    return render(request, "layer_uploader/success.html")