-- Persist deployment schema marker for Settings (PostgreSQL server mode).

CREATE TABLE IF NOT EXISTS app_meta (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '37', NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;
