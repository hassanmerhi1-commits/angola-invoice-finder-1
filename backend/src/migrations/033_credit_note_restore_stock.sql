-- Persist restore-stock flag on issued credit notes (AGT Phase 1)

ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS restore_stock BOOLEAN NOT NULL DEFAULT true;

UPDATE credit_notes SET restore_stock = true WHERE restore_stock IS NULL;
