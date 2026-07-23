-- Per-branch VAT override: when true, HQ/Sede tax_rate cascade skips this row.
ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_override BOOLEAN NOT NULL DEFAULT FALSE;
