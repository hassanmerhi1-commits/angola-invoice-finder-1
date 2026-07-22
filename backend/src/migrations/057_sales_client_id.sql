-- Link credit/on-account sales to the registered client row.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales (client_id) WHERE client_id IS NOT NULL;
