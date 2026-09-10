-- Inventory product tabs: latest movements for one SKU (via product_id).
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created
  ON stock_movements (product_id, created_at DESC);
