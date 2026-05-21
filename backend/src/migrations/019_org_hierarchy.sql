-- Org hierarchy: cities, branch roles, installations, sync outbox

CREATE TABLE IF NOT EXISTS cities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    province VARCHAR(255),
    municipio VARCHAR(255),
    code VARCHAR(32) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES cities(id);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS parent_branch_id UUID REFERENCES branches(id);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS node_role VARCHAR(20) DEFAULT 'shop'
    CHECK (node_role IN ('main', 'city_hub', 'shop'));

CREATE TABLE IF NOT EXISTS installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL DEFAULT 'Default',
    role VARCHAR(32) NOT NULL CHECK (role IN ('main_server', 'city_server', 'shop_client')),
    city_id UUID REFERENCES cities(id),
    branch_id UUID REFERENCES branches(id),
    main_api_url TEXT,
    api_key VARCHAR(128) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(64) NOT NULL,
    entity_id UUID,
    branch_id UUID REFERENCES branches(id),
    city_id UUID REFERENCES cities(id),
    payload JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(128) NOT NULL,
    destinations JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP,
    destinations_done JSONB NOT NULL DEFAULT '[]',
    UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_events_status_retry ON sync_events(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sync_events_branch ON sync_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_branches_city ON branches(city_id);
CREATE INDEX IF NOT EXISTS idx_branches_node_role ON branches(node_role);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id)
    WHERE client_request_id IS NOT NULL AND client_request_id != '';

UPDATE branches SET node_role = 'main' WHERE is_main = true AND (node_role IS NULL OR node_role = 'shop');
