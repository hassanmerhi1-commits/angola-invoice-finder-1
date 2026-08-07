-- Faster inventory-grid / stock ledger lookups by warehouse then product.
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse_product
  ON stock_movements (warehouse_id, product_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse_created
  ON stock_movements (warehouse_id, created_at DESC);
