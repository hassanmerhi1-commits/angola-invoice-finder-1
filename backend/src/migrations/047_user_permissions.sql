-- Per-user permission overrides (grant/revoke deltas on top of the role).
-- Stored as JSON text: {"granted":["perm_id", ...],"revoked":["perm_id", ...]}
-- NULL/empty means the user inherits exactly their role's default permissions.

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT;

INSERT INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '47', NOW())
ON CONFLICT (key) DO UPDATE
SET value = GREATEST(app_meta.value::integer, EXCLUDED.value::integer)::text,
    updated_at = EXCLUDED.updated_at;
