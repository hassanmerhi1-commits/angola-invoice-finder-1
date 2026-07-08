-- Migration 040: users.username + users.updated_at (required by /api/auth/users)

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

UPDATE users
SET username = LOWER(SPLIT_PART(email, '@', 1))
WHERE username IS NULL OR TRIM(COALESCE(username, '')) = '';

-- Legacy bad emails (e.g. merhi@123) → merhi@kwanzaerp.ao when domain has no dot
UPDATE users u
SET email = LOWER(SPLIT_PART(u.email, '@', 1)) || '@kwanzaerp.ao',
    updated_at = CURRENT_TIMESTAMP
WHERE u.email LIKE '%@%'
  AND POSITION('.' IN SPLIT_PART(u.email, '@', 2)) = 0
  AND NOT EXISTS (
    SELECT 1 FROM users u2
    WHERE u2.id <> u.id
      AND LOWER(u2.email) = LOWER(SPLIT_PART(u.email, '@', 1)) || '@kwanzaerp.ao'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (LOWER(username))
  WHERE username IS NOT NULL AND TRIM(username) <> '';

INSERT INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '38', NOW())
ON CONFLICT (key) DO UPDATE
SET value = GREATEST(app_meta.value::integer, EXCLUDED.value::integer)::text,
    updated_at = EXCLUDED.updated_at;
