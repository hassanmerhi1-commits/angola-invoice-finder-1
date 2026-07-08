-- Expenses stored on the server (PostgreSQL) — required for LAN clients and postgres server mode.
CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR(64) PRIMARY KEY,
  expense_number VARCHAR(64) NOT NULL DEFAULT '',
  branch_id VARCHAR(64) NOT NULL DEFAULT '',
  branch_name VARCHAR(255) NOT NULL DEFAULT '',
  category VARCHAR(32) NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '',
  amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  payment_source VARCHAR(16) NOT NULL DEFAULT 'caixa',
  caixa_id VARCHAR(64),
  bank_account_id VARCHAR(64),
  payee_name VARCHAR(255),
  invoice_number VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(128),
  approved_by VARCHAR(128),
  approved_at TIMESTAMPTZ,
  paid_by VARCHAR(128),
  paid_at TIMESTAMPTZ,
  transaction_id VARCHAR(64),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_branch ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
