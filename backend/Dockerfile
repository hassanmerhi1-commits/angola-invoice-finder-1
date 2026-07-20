# NEXOR ERP backend API (Express) — headless server for Docker deployment.
# Runs the same /api the desktop app serves, backed by PostgreSQL.
FROM node:22-bookworm-slim

# Build tools for native deps + PostgreSQL 16 client (must match postgres:16 server).
# Debian bookworm's default postgresql-client is 15 and aborts pg_dump against PG 16.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg python3 make g++ wget \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# Application source.
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    AUTO_BACKUP=1 \
    AUTO_BACKUP_INTERVAL_HOURS=24 \
    AUTO_BACKUP_KEEP=14

EXPOSE 3000

# Entrypoint applies pending migrations, then starts the API.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health?lite=1 >/dev/null 2>&1 || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
