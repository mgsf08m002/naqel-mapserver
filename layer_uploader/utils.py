# layer_uploader/utils.py

import re

def simplify_crs(crs):
    """
    Extract readable CRS name and EPSG from WKT or dict
    """
    if not crs:
        return "Unknown CRS", None

    crs_str = str(crs)

    # Extract EPSG (last occurrence is usually correct)
    epsg_match = re.findall(r'EPSG","(\d+)"', crs_str)
    epsg = epsg_match[-1] if epsg_match else None

    # Extract projection name
    name_match = re.search(r'PROJCS\["([^"]+)"', crs_str)

    if name_match:
        name = name_match.group(1)
    else:
        name = "Unknown CRS"

    return name, epsg