# GeoTrak Maps
#
# Django + MapLibre editor for the Riyadh road network.
# Databases, Martin and Nginx live in ../geo_infra.
#
# Public URL (via shared Nginx): http://<host>:8000
#
# First-time bring-up (production compose):
#   cd ../geo_infra && docker compose up -d
#   cp .env.prod .env          # on VPS only - locally .env already exists
#   docker compose -f docker-compose.prod.yml up -d --build
# Ongoing production updates: use Actions "Deploy to production" (see below).
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

## Production deploy (GitHub Actions)

Pushing to `main` does **not** update the VPS. Deploy only when you click the button:

1. Push your changes to `main`.
2. GitHub → **Actions** → **Deploy to production** → **Run workflow**.
3. Wait for the run to go green (SSH → `scripts/deploy.sh` → rebuild → smoke check on `:8000`).

Emergency fallback on the VPS (same script Actions uses):

```bash
cd /path/to/geotrak-maps   # VPS folder name; local clone may be naqel-mapserver
./scripts/deploy.sh
```

### Required GitHub Actions secrets

Repo **Settings → Secrets and variables → Actions**:

| Secret | Meaning |
| --- | --- |
| `DEPLOY_HOST` | VPS hostname or IP |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_SSH_KEY` | Private key (full PEM) that can SSH as that user |
| `DEPLOY_PATH` | Absolute path to this repo clone on the VPS (e.g. `/root/Naqel-Server/geotrak-maps`) |
| `DEPLOY_SSH_PORT` | Optional; defaults to `22` if unset |

The VPS clone must be able to `git pull origin main` non-interactively. Shared infra (`geo_infra`) and GeoLayers have their own Deploy workflows.

