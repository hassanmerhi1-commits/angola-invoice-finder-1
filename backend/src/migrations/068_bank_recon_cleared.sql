-- Bank reconciliation: mark matched bank_transactions as cleared (no second GL for matched pairs).
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS is_reconciled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS reconciliation_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciled
  ON bank_transactions (bank_account_id, is_reconciled)
  WHERE is_reconciled = true;
