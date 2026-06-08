-- Migration 026: Sync audit trail (Phase B0)

CREATE TABLE IF NOT EXISTS sync_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_event_id UUID,
    event_type VARCHAR(64),
    entity_type VARCHAR(50),
    entity_id UUID,
    branch_id UUID REFERENCES branches(id),
    source VARCHAR(32) NOT NULL,
    destination VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(128),
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_audit_created ON sync_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_audit_event ON sync_audit_log(sync_event_id);
CREATE INDEX IF NOT EXISTS idx_sync_audit_branch ON sync_audit_log(branch_id);
CREATE INDEX IF NOT EXISTS idx_sync_audit_destination ON sync_audit_log(destination, status);
