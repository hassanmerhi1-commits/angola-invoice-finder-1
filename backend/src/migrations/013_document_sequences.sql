-- Migration 013: Canonical document sequences for atomic numbering across all document types

-- Replace the legacy branch-based sequence table from migration 002 if it still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_sequences'
      AND column_name = 'current_sequence'
  ) THEN
    DROP TABLE public.document_sequences;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.document_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(50) NOT NULL,
  prefix VARCHAR(10) NOT NULL,
  fiscal_year INTEGER NOT NULL,
  current_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_type, fiscal_year)
);

-- Seed sequences for the current fiscal year based on existing business documents.
DO $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  has_branch BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_sequences'
      AND column_name = 'branch_id'
  ) INTO has_branch;

  IF has_branch THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_sequences_scope
      ON public.document_sequences(document_type, fiscal_year, branch_id);

    INSERT INTO public.document_sequences (document_type, prefix, fiscal_year, branch_id, current_number)
    VALUES
      ('invoice', 'INV', yr, '', COALESCE((SELECT COUNT(*) FROM sales WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('payment_receipt', 'REC', yr, '', COALESCE((SELECT COUNT(*) FROM payments WHERE payment_type = 'receipt' AND EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('payment_out', 'PAG', yr, '', COALESCE((SELECT COUNT(*) FROM payments WHERE payment_type = 'payment' AND EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('purchase_order', 'PO', yr, '', COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('stock_transfer', 'TRF', yr, '', COALESCE((SELECT COUNT(*) FROM stock_transfers WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('journal', 'JE', yr, '', COALESCE((SELECT COUNT(*) FROM journal_entries WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('purchase_invoice', 'FC', yr, '', COALESCE((
        SELECT COUNT(*) FROM open_items
        WHERE document_type IN ('fatura_compra', 'purchase_invoice')
          AND EXTRACT(YEAR FROM document_date::date) = yr
      ), 0))
    ON CONFLICT (document_type, fiscal_year, branch_id) DO UPDATE
    SET
      prefix = EXCLUDED.prefix,
      current_number = GREATEST(public.document_sequences.current_number, EXCLUDED.current_number);
  ELSE
    INSERT INTO public.document_sequences (document_type, prefix, fiscal_year, current_number)
    VALUES
      ('invoice', 'INV', yr, COALESCE((SELECT COUNT(*) FROM sales WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('payment_receipt', 'REC', yr, COALESCE((SELECT COUNT(*) FROM payments WHERE payment_type = 'receipt' AND EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('payment_out', 'PAG', yr, COALESCE((SELECT COUNT(*) FROM payments WHERE payment_type = 'payment' AND EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('purchase_order', 'PO', yr, COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('stock_transfer', 'TRF', yr, COALESCE((SELECT COUNT(*) FROM stock_transfers WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('journal', 'JE', yr, COALESCE((SELECT COUNT(*) FROM journal_entries WHERE EXTRACT(YEAR FROM created_at) = yr), 0)),
      ('purchase_invoice', 'FC', yr, COALESCE((
        SELECT COUNT(*) FROM open_items
        WHERE document_type IN ('fatura_compra', 'purchase_invoice')
          AND EXTRACT(YEAR FROM document_date::date) = yr
      ), 0))
    ON CONFLICT (document_type, fiscal_year) DO UPDATE
    SET
      prefix = EXCLUDED.prefix,
      current_number = GREATEST(public.document_sequences.current_number, EXCLUDED.current_number);
  END IF;
END $$;
