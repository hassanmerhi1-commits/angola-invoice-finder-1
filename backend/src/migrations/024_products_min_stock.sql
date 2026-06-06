-- Reorder point / min stock on products (daily checklist, low-stock alerts)
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock NUMERIC NOT NULL DEFAULT 0;
