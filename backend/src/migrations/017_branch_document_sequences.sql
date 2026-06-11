-- Migration 017: Per-branch document sequences (purchase invoices)

ALTER TABLE public.document_sequences
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(64) NOT NULL DEFAULT '';

ALTER TABLE public.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_document_type_fiscal_year_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_sequences_scope
  ON public.document_sequences(document_type, fiscal_year, branch_id);

DO $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  br RECORD;
  max_seq INTEGER;
BEGIN
  FOR br IN SELECT id, code FROM branches LOOP
    SELECT COALESCE(MAX(
      CASE
        WHEN document_number ~ ('^FC-' || UPPER(REGEXP_REPLACE(COALESCE(br.code, 'SEDE'), '[^A-Z0-9]', '', 'g')) || '-' || yr::TEXT || '-[0-9]+$')
        THEN SUBSTRING(document_number FROM '[0-9]+$')::INTEGER
        WHEN document_number ~ ('^FC-' || yr::TEXT || '-[0-9]+$')
        THEN SUBSTRING(document_number FROM '[0-9]+$')::INTEGER
        ELSE 0
      END
    ), 0) INTO max_seq
    FROM open_items
    WHERE document_type IN ('fatura_compra', 'purchase_invoice')
      AND branch_id::TEXT = br.id::TEXT
      AND EXTRACT(YEAR FROM COALESCE(document_date::date, created_at::date)) = yr;

    INSERT INTO public.document_sequences (document_type, prefix, fiscal_year, branch_id, current_number)
    VALUES ('purchase_invoice', 'FC', yr, br.id::TEXT, max_seq)
    ON CONFLICT (document_type, fiscal_year, branch_id) DO UPDATE
    SET current_number = GREATEST(public.document_sequences.current_number, EXCLUDED.current_number);
  END LOOP;
END $$;
