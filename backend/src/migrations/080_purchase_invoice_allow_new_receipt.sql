-- Persist explicit second-receipt authorization on the FC header
-- so retries / repost cannot drop the flag.
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS allow_new_receipt BOOLEAN NOT NULL DEFAULT false;
