-- Migration 054: FC freight treasury source (caixa / bank picker)

ALTER TABLE purchase_invoices
ADD COLUMN IF NOT EXISTS freight_payment_source TEXT DEFAULT 'caixa',
ADD COLUMN IF NOT EXISTS freight_caixa_id TEXT,
ADD COLUMN IF NOT EXISTS freight_bank_account_id TEXT;
