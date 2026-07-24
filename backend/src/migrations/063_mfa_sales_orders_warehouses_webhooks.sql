-- P3/P4: MFA, sales orders, warehouses, webhooks, job queue, bank match rules

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT;

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY,
  order_number VARCHAR(100) NOT NULL,
  client_id VARCHAR(64) DEFAULT '',
  client_name VARCHAR(255) NOT NULL DEFAULT '',
  client_nif VARCHAR(50) DEFAULT '',
  customer_email VARCHAR(255) DEFAULT '',
  customer_phone VARCHAR(50) DEFAULT '',
  customer_address TEXT DEFAULT '',
  branch_id VARCHAR(64) DEFAULT '',
  branch_name VARCHAR(255) DEFAULT '',
  warehouse_id VARCHAR(64) DEFAULT '',
  subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  discount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  total DECIMAL(15, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'AOA',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  reserved_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  converted_to_invoice_id VARCHAR(64) DEFAULT '',
  converted_to_invoice_number VARCHAR(100) DEFAULT '',
  converted_at TIMESTAMPTZ,
  created_by VARCHAR(64) DEFAULT '',
  created_by_name VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id UUID PRIMARY KEY,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id VARCHAR(64) DEFAULT '',
  product_name VARCHAR(255) NOT NULL DEFAULT '',
  sku VARCHAR(100) DEFAULT '',
  description TEXT DEFAULT '',
  quantity DECIMAL(15, 4) NOT NULL DEFAULT 1,
  reserved_qty DECIMAL(15, 4) NOT NULL DEFAULT 0,
  unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
  discount DECIMAL(8, 4) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(8, 4) NOT NULL DEFAULT 14,
  tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
  total DECIMAL(15, 2) NOT NULL DEFAULT 0,
  branch_id VARCHAR(64) DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_branch ON sales_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(sales_order_id);

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY,
  branch_id UUID REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_branch ON warehouses(branch_id);

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON webhook_deliveries (status, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS job_queue (
  id UUID PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON job_queue (status, run_after)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS bank_match_rules (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  match_field TEXT NOT NULL DEFAULT 'description',
  entity_type TEXT,
  entity_hint TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
