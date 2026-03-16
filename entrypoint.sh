#!/bin/sh

set -e

echo "==> [Naqel_Maps] Starting container"

echo "==> [Naqel_Maps] Compiling Tailwind CSS assets"
mkdir -p /app/static/css
tailwindcss -i /app/static/src/input.css -o /app/static/css/output.css --minify

echo "==> [Naqel_Maps] Waiting for PostgreSQL database on host 'db'"
while ! PGPASSWORD="$DB_PASSWORD" pg_isready -h db -U "$DB_USER" > /dev/null 2>&1; do
  printf '.'
  sleep 1
done
echo " database is ready."

echo "==> [Naqel_Maps] Running Django makemigrations"
python manage.py makemigrations

echo "==> [Naqel_Maps] Applying Django migrations"
python manage.py migrate

echo "==> [Naqel_Maps] Starting Django development server on 0.0.0.0:8000"
exec python manage.py runserver 0.0.0.0:8000

