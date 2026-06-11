-- Phase 5 fix: allow fiscal audit actions (agt_transmit, issue, saft_export, …)
-- Migration 007 restricted action to a legacy enum; new events were silently rejected.

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE audit_log ALTER COLUMN action TYPE VARCHAR(64);

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS workstation_id VARCHAR(255);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_action ON audit_log(table_name, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
