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

BULK_CREATE_BATCH_SIZE = 2500
SHAPEFILE_INSERT_BATCH_SIZE = 5000
