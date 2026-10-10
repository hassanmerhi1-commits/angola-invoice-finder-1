-- sale_items.sale_id is a foreign key, which PostgreSQL does not index on its own, so every
-- "items of these sales" lookup (reports, invoice detail, SAF-T, AGT, voids) scanned the table.
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);

-- Report / invoice lists filter one branch by date range.
CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales (branch_id, created_at DESC);

ANALYZE sale_items;
ANALYZE sales;
