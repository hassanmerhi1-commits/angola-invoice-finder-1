-- Persist login / elevate lockouts across backend restarts.
CREATE TABLE IF NOT EXISTS login_attempts (
  identifier TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_locked_until
  ON login_attempts (locked_until);
