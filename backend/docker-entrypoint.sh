#!/usr/bin/env bash
# Wait for Postgres, apply migrations, then launch the API.
set -e

echo "[entrypoint] Waiting for PostgreSQL to accept connections..."
node -e '
const { Pool } = require("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("[entrypoint] DATABASE_URL not set"); process.exit(1); }
(async () => {
  const pool = new Pool({ connectionString: url });
  for (let i = 1; i <= 30; i++) {
    try { await pool.query("SELECT 1"); await pool.end(); console.log("[entrypoint] Postgres is ready"); process.exit(0); }
    catch (e) { console.log(`[entrypoint] (${i}/30) waiting: ${e.code || e.message}`); await new Promise(r => setTimeout(r, 2000)); }
  }
  console.error("[entrypoint] Postgres did not become ready in time");
  process.exit(1);
})();
'

echo "[entrypoint] Applying database migrations..."
node src/migrations/run.js || {
  echo "[entrypoint] Migration failed" >&2
  exit 1
}

echo "[entrypoint] Starting NEXOR ERP API on :${PORT:-3000}"
exec node src/server.js
