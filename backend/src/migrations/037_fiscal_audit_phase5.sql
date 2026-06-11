-- Phase 5: fiscal audit trail extensions

ALTER TABLE audit_log ADD COLUMN metadata JSONB;
ALTER TABLE audit_log ADD COLUMN workstation_id VARCHAR(255);
ALTER TABLE audit_log ADD COLUMN ip_address VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_action ON audit_log(table_name, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
