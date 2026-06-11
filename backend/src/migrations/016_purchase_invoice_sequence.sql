-- Migration 016: Purchase invoice (FC) document sequence

DO $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  max_fc INTEGER;
  has_branch BOOLEAN;
BEGIN
  SELECT COALESCE((
    SELECT COUNT(*) FROM open_items
    WHERE document_type IN ('fatura_compra', 'purchase_invoice')
      AND EXTRACT(YEAR FROM COALESCE(document_date::date, created_at::date)) = yr
  ), 0) INTO max_fc;

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
    VALUES ('purchase_invoice', 'FC', yr, '', max_fc)
    ON CONFLICT (document_type, fiscal_year, branch_id) DO UPDATE
    SET
      prefix = EXCLUDED.prefix,
      current_number = GREATEST(public.document_sequences.current_number, EXCLUDED.current_number);
  ELSE
    INSERT INTO public.document_sequences (document_type, prefix, fiscal_year, current_number)
    VALUES ('purchase_invoice', 'FC', yr, max_fc)
    ON CONFLICT (document_type, fiscal_year) DO UPDATE
    SET
      prefix = EXCLUDED.prefix,
      current_number = GREATEST(public.document_sequences.current_number, EXCLUDED.current_number);
  END IF;
END $$;
