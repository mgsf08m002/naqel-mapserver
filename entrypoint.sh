#!/bin/sh

set -e

echo "==> [GeoTrak_Maps] Starting container"

echo "==> [GeoTrak_Maps] Compiling Tailwind CSS assets"
mkdir -p /app/static/css
tailwindcss -i /app/static/src/input.css -o /app/static/css/output.css --minify

DB_HOST="${DB_HOST:-postgis}"
DB_PORT="${DB_PORT:-5432}"
echo "==> [GeoTrak_Maps] Waiting for PostgreSQL on ${DB_HOST}:${DB_PORT} (shared geo-infra stack)"
while ! PGPASSWORD="$DB_PASSWORD" pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; do
  printf '.'
  sleep 1
done
echo " database is ready."

case "$(echo "${DEBUG:-false}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    echo "==> [GeoTrak_Maps] DEBUG — running makemigrations"
    python manage.py makemigrations
    ;;
esac

echo "==> [GeoTrak_Maps] Applying Django migrations"
python manage.py migrate

echo "==> [GeoTrak_Maps] Collecting static files"
python manage.py collectstatic --noinput

case "$(echo "${DEBUG:-false}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    echo "==> [GeoTrak_Maps] DEBUG enabled — starting Django development server on 0.0.0.0:8000"
    exec python manage.py runserver 0.0.0.0:8000
    ;;
  *)
    echo "==> [GeoTrak_Maps] Production mode — starting Gunicorn on 0.0.0.0:8000"
    exec gunicorn config.wsgi:application \
      --bind 0.0.0.0:8000 \
      --workers "${GUNICORN_WORKERS:-3}"       --worker-class gthread       --threads "${GUNICORN_THREADS:-4}" \
      --timeout "${GUNICORN_TIMEOUT:-120}" \
      --access-logfile - \
      --error-logfile -
    ;;
esac
