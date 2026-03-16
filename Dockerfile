FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies for GDAL/PostGIS (quieter apt output)
RUN apt-get update -qq && apt-get install -y \
    curl \
    gdal-bin \
    libgdal-dev \
    python3-gdal \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Tailwind CSS CLI
RUN curl -sLO https://github.com/tailwindlabs/tailwindcss/releases/latest/download/tailwindcss-linux-x64 && \
    chmod +x tailwindcss-linux-x64 && \
    mv tailwindcss-linux-x64 /usr/local/bin/tailwindcss

# Install Python dependencies (quieter pip output)
COPY requirements.txt /app/
RUN pip install --no-cache-dir -q -r requirements.txt

# Copy entrypoint separately to avoid being overridden by bind mounts
COPY entrypoint.sh /usr/local/bin/naqel_entrypoint.sh

# Copy project
COPY . /app/

# Normalize line endings and ensure entrypoint is executable
RUN sed -i 's/\r$//' /usr/local/bin/naqel_entrypoint.sh && \
    chmod +x /usr/local/bin/naqel_entrypoint.sh

# Expose port
EXPOSE 8000

# Default command (may be overridden by docker-compose)
CMD ["/usr/local/bin/naqel_entrypoint.sh"]

