-- Operational bank ledger lines (manual/transfer/expense/sale references).
CREATE TABLE IF NOT EXISTS bank_transactions (
  id VARCHAR(64) PRIMARY KEY,
  bank_account_id VARCHAR(64) NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  branch_id VARCHAR(64) NOT NULL DEFAULT '',
  type VARCHAR(32) NOT NULL DEFAULT 'manual',
  direction VARCHAR(8) NOT NULL DEFAULT 'in',
  amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(18, 2) NOT NULL DEFAULT 0,
  reference_type VARCHAR(32),
  reference_id VARCHAR(64),
  reference_number VARCHAR(64),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  value_date DATE,
  bank_reference VARCHAR(128),
  description TEXT NOT NULL DEFAULT '',
  category VARCHAR(64),
  payee VARCHAR(255),
  created_by VARCHAR(64),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account
  ON bank_transactions (bank_account_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_branch
  ON bank_transactions (branch_id);
