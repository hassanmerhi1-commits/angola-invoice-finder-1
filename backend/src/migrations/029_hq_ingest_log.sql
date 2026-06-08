-- Migration 029: Idempotent HQ mirror ingest (Phase B4)

CREATE TABLE IF NOT EXISTS hq_ingest_log (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    entity_id UUID,
    branch_id UUID REFERENCES branches(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hq_ingest_branch ON hq_ingest_log(branch_id, created_at DESC);
