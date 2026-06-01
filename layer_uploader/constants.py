"""Tuning for layer upload review performance."""

TABLE_PAGE_SIZE_DEFAULT = 50
TABLE_PAGE_SIZE_MAX = 200
# Max rows returned by table.json?list=all (full-screen features panel).
TABLE_LIST_ALL_MAX = 100_000

# Layers above this count use paginated table + viewport map loading.
LARGE_LAYER_FEATURE_THRESHOLD = 2000

GEOJSON_VIEWPORT_LIMIT = 4000
GEOJSON_SMALL_LAYER_LIMIT = 2500

FEATURE_PROPERTY_ROWS_TABLE = 4

# Shapefile fields shown in the dedicated Road name column (excluded from Properties).
TABLE_PROPERTY_SKIP_KEYS = frozenset(
    {
        "name",
        "name_en",
        "name_ar",
        "name:en",
        "name:ar",
        "road_name",
        "other_tags",
    }
)

BULK_CREATE_BATCH_SIZE = 2500
SHAPEFILE_INSERT_BATCH_SIZE = 5000

# Meters (EPSG:3857) — upload features within this distance of an existing road
# are treated as already on the network and excluded from the review "New" set.
ROAD_NETWORK_OVERLAP_TOLERANCE_M = 1
