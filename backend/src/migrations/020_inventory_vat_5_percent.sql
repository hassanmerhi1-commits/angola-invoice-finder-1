-- One-time: set all active inventory products to 5% VAT (default rate)
CREATE TABLE IF NOT EXISTS schema_patches (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE products
SET tax_rate = 5.00,
    tax_code = 'IVA5',
    updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(is_active, true) IS NOT FALSE;

INSERT INTO schema_patches (id)
VALUES ('020_inventory_vat_5')
ON CONFLICT (id) DO NOTHING;
