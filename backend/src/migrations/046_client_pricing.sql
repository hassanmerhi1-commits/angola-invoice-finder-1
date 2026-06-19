-- Migration 046: Per-client pricing controls
-- Adds default_price_level (which of the 4 product price levels to use for this
-- client) and price_adjustment_pct (signed %: positive = surcharge, negative =
-- discount) applied automatically in POS and sales invoices.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='default_price_level') THEN
    ALTER TABLE clients ADD COLUMN default_price_level INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='price_adjustment_pct') THEN
    ALTER TABLE clients ADD COLUMN price_adjustment_pct NUMERIC(7,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='payment_terms_days') THEN
    ALTER TABLE clients ADD COLUMN payment_terms_days INTEGER DEFAULT 0;
  END IF;
END $$;
