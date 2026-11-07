# GeoTrak Maps
#
# Django + MapLibre editor for the Riyadh road network.
# Databases, Martin and Nginx live in ../geo_infra.
#
# Public URL (via shared Nginx): http://<host>:8000
#
# Quick start (production compose):
#   cd ../geo_infra && docker compose up -d
#   cp .env.prod .env          # on VPS only - locally .env already exists
#   docker compose -f docker-compose.prod.yml up -d --build
#
# Local live-reload: docker compose up -d --build
#
# Secrets in this app's .env must match geo_infra/.env:
#   DB_PASSWORD / RIYADH_ROADS_DB_PASSWORD  =  GEOTRAK_DB_PASSWORD
#   TILE_AUTH_SHARED_SECRET                =  TILE_AUTH_SHARED_SECRET
#
# Product version (UI + static cache bust + What's New):
#   VERSION file at repo root (default), or override with GEOTRAK_APP_VERSION in .env
#   Banners (optional): static/images/whats-new/<version>-en.png and -ar.png

