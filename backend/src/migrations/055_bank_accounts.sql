-- Operational bank accounts for expenses, payments, and treasury (per branch).
CREATE TABLE IF NOT EXISTS bank_accounts (
  id VARCHAR(64) PRIMARY KEY,
  branch_id VARCHAR(64) NOT NULL DEFAULT '',
  branch_name VARCHAR(255) NOT NULL DEFAULT '',
  bank_name VARCHAR(255) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  account_number VARCHAR(100) NOT NULL DEFAULT '',
  iban VARCHAR(64) DEFAULT '',
  swift VARCHAR(32) DEFAULT '',
  currency VARCHAR(8) NOT NULL DEFAULT 'AOA',
  balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch ON bank_accounts (branch_id);
