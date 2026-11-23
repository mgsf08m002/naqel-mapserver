#!/usr/bin/env bash
# Production deploy for GeoTrak Maps on the VPS.
# GitHub Actions and SSH fallback both run:
#   cd /path/to/geotrak-maps && ./scripts/deploy.sh
#
# Set SKIP_GIT_PULL=1 when the caller already updated the working tree
# (the Actions workflow pulls before invoking this script).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.prod.yml)

echo "==> Deploying GeoTrak Maps from $(pwd)"

if [[ "${SKIP_GIT_PULL:-}" != "1" ]]; then
  echo "==> Fetching origin/main"
  git fetch origin main
  git checkout main
  git pull --ff-only origin main
fi

SHA="$(git rev-parse --short HEAD)"
echo "==> Rebuilding at ${SHA}"
"${COMPOSE[@]}" up -d --build

echo "==> Waiting for geotrak_maps"
web_up=0
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx geotrak_maps; then
    web_up=1
    break
  fi
  sleep 2
done
"${COMPOSE[@]}" ps
if [[ "$web_up" -ne 1 ]]; then
  echo "ERROR: service geotrak_maps is not running" >&2
  "${COMPOSE[@]}" logs --tail=80 geotrak_maps || true
  exit 1
fi

echo "==> Smoke check :8000"
ok=0
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8000/ || true)"
  if [[ "$code" != "000" && "$code" != "" ]]; then
    echo "    HTTP ${code}"
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: GeoTrak Maps did not respond on http://127.0.0.1:8000/" >&2
  "${COMPOSE[@]}" logs --tail=80 geotrak_maps || true
  exit 1
fi

echo "==> Deployed GeoTrak Maps ${SHA} OK"
