-- In-progress bank statement reconciliation sessions (one per bank account).
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id VARCHAR(64) PRIMARY KEY,
  bank_account_id VARCHAR(64) NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  branch_id VARCHAR(64) NOT NULL DEFAULT '',
  statement_rows TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'in_progress',
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bank_account_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_account
  ON bank_reconciliations (bank_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_branch
  ON bank_reconciliations (branch_id);
