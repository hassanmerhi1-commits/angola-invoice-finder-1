-- Product statement / details: latest rows for one product at one warehouse.
-- (warehouse_id, created_at) made the planner walk the whole branch ledger.
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_wh_created
  ON stock_movements (product_id, warehouse_id, created_at DESC);

ANALYZE stock_movements;
