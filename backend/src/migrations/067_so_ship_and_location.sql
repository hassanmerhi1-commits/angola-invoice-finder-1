-- Sales order line shipped qty (partial ship without full WMS picking).
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS shipped_qty NUMERIC(18, 4) NOT NULL DEFAULT 0;

-- Optional warehouse location stamp on movements (metadata; ledger key remains branch id).
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS location_id VARCHAR(64) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_location
  ON stock_movements (location_id)
  WHERE location_id IS NOT NULL;
