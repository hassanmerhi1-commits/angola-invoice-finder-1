# NEXOR ERP backend API (Express) — headless server for Docker deployment.
# Runs the same /api the desktop app serves, backed by PostgreSQL.
FROM node:22-bookworm-slim

# Build tools for native deps (better-sqlite3 is only used by the one-time
# SQLite->Postgres migration script; the running server uses pg).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates wget postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# Application source.
COPY . .

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Entrypoint applies pending migrations, then starts the API.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health?lite=1 >/dev/null 2>&1 || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
