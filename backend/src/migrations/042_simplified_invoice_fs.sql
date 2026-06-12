-- Phase FS — simplified invoice (Fatura Simplificada) for final consumers

ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(4) NOT NULL DEFAULT 'FT';

CREATE INDEX IF NOT EXISTS idx_sales_invoice_type ON sales(invoice_type);

-- Per-branch sequences for FS / FR / FT (AGT document prefixes)
DO $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  b RECORD;
BEGIN
  FOR b IN SELECT id FROM branches LOOP
    INSERT INTO document_sequences (document_type, prefix, fiscal_year, current_number, branch_id)
    VALUES
      ('simplified_invoice', 'FS', yr, 0, b.id),
      ('invoice_receipt', 'FR', yr, 0, b.id),
      ('sales_invoice', 'FT', yr, 0, b.id)
    ON CONFLICT (document_type, fiscal_year, branch_id) DO NOTHING;
  END LOOP;

  INSERT INTO document_sequences (document_type, prefix, fiscal_year, current_number, branch_id)
  VALUES
    ('simplified_invoice', 'FS', yr, 0, ''),
    ('invoice_receipt', 'FR', yr, 0, ''),
    ('sales_invoice', 'FT', yr, 0, '')
  ON CONFLICT (document_type, fiscal_year, branch_id) DO NOTHING;
END $$;
