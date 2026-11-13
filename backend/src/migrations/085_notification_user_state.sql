-- Read and dismiss are per person. A shared is_read flag made one manager's
-- Clear mark every city's alerts as read for everyone else.
CREATE TABLE IF NOT EXISTS notification_user_state (
  user_id TEXT NOT NULL,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_user_state_user
  ON notification_user_state (user_id);
