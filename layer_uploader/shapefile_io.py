"""Shapefile upload discovery and validation helpers."""

import os
import zipfile
from collections import defaultdict

import fiona

from .utils import simplify_crs

REQUIRED_EXTENSIONS = frozenset({".shp", ".shx", ".dbf"})


def find_shapefile_path(temp_dir: str, base_name: str) -> str | None:
    for root, _, files in os.walk(temp_dir):
        for file_name in files:
            if file_name.startswith(base_name) and file_name.endswith(".shp"):
                return os.path.join(root, file_name)
    return None


def collect_detected_shapefiles(temp_dir: str) -> list[dict]:
    grouped_extensions: dict[str, set[str]] = defaultdict(set)
    for root, _, filenames in os.walk(temp_dir):
        for filename in filenames:
            base, ext = os.path.splitext(filename)
            grouped_extensions[base].add(ext.lower())

    detected = []
    for base_name, exts in grouped_extensions.items():
        if not REQUIRED_EXTENSIONS.issubset(exts):
            continue
        shp_path = find_shapefile_path(temp_dir, base_name)
        if not shp_path:
            continue
        try:
            with fiona.open(shp_path) as source:
                crs_name, epsg = simplify_crs(source.crs)
                detected.append(
                    {
                        "name": base_name,
                        "crs_name": crs_name,
                        "epsg": epsg if epsg else "Not defined",
                        "count": len(source),
                    }
                )
        except Exception as exc:
            detected.append({"name": base_name, "error": str(exc)})
    return detected


def extract_upload_to_temp(uploaded_files) -> str:
    """Save uploaded files (and unzip archives) into a new temp directory."""
    import tempfile

    temp_dir = tempfile.mkdtemp()
    for uploaded_file in uploaded_files:
        path = os.path.join(temp_dir, uploaded_file.name)
        with open(path, "wb+") as dest:
            for chunk in uploaded_file.chunks():
                dest.write(chunk)
        if uploaded_file.name.endswith(".zip"):
            with zipfile.ZipFile(path, "r") as zip_ref:
                zip_ref.extractall(temp_dir)
    return temp_dir
