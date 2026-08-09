-- Faster Purchases list ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_created_at
  ON purchase_invoices (created_at DESC);
