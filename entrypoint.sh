#!/bin/sh

set -e

echo "==> [GeoTrak_Maps] Starting container"

echo "==> [GeoTrak_Maps] Compiling Tailwind CSS assets"
mkdir -p /app/static/css
tailwindcss -i /app/static/src/input.css -o /app/static/css/output.css --minify

echo "==> [GeoTrak_Maps] Waiting for PostgreSQL database on host 'db'"
while ! PGPASSWORD="$DB_PASSWORD" pg_isready -h db -U "$DB_USER" > /dev/null 2>&1; do
  printf '.'
  sleep 1
done
echo " database is ready."

echo "==> [GeoTrak_Maps] Running Django makemigrations"
python manage.py makemigrations

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
      --workers "${GUNICORN_WORKERS:-3}" \
      --timeout "${GUNICORN_TIMEOUT:-120}" \
      --access-logfile - \
      --error-logfile -
    ;;
esac
