-- Migration 028: Idempotent shop client ingest (Phase B3)

CREATE TABLE IF NOT EXISTS client_ingest_log (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    entity_id UUID,
    branch_id UUID REFERENCES branches(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_ingest_branch ON client_ingest_log(branch_id, created_at DESC);
