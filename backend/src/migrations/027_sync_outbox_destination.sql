-- Migration 027: One row per sync destination (Phase B0)

ALTER TABLE sync_events ADD COLUMN IF NOT EXISTS destination VARCHAR(32);
ALTER TABLE sync_events ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_sync_events_dest_status
    ON sync_events(destination, status, next_retry_at)
    WHERE destination IS NOT NULL;
