-- Migration 016: Purchase invoice (FC) document sequence

DO $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
  INSERT INTO public.document_sequences (document_type, prefix, fiscal_year, current_number)
  VALUES (
    'purchase_invoice',
    'FC',
    yr,
    COALESCE((
      SELECT COUNT(*) FROM open_items
      WHERE document_type IN ('fatura_compra', 'purchase_invoice')
        AND EXTRACT(YEAR FROM COALESCE(document_date::date, created_at::date)) = yr
    ), 0)
  )
  ON CONFLICT (document_type, fiscal_year) DO UPDATE
  SET
    prefix = EXCLUDED.prefix,
    current_number = GREATEST(public.document_sequences.current_number, EXCLUDED.current_number);
END $$;
