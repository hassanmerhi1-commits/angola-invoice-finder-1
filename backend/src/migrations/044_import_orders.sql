-- Import orders (importação) — header + lines, landed cost workflow

CREATE TABLE IF NOT EXISTS import_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(40) NOT NULL,
    supplier_id UUID REFERENCES suppliers(id),
    supplier_name VARCHAR(255) NOT NULL,
    supplier_country VARCHAR(100) DEFAULT '',
    transport_mode VARCHAR(20) DEFAULT 'sea',
    incoterm VARCHAR(10) DEFAULT 'FOB',
    port_of_origin VARCHAR(120) DEFAULT '',
    port_of_destination VARCHAR(120) DEFAULT '',
    currency VARCHAR(10) DEFAULT 'USD',
    exchange_rate DECIMAL(15, 6) NOT NULL DEFAULT 1,
    fob_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
    fob_value_aoa DECIMAL(15, 2) NOT NULL DEFAULT 0,
    freight_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    insurance_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    cif_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
    customs_declaration_number VARCHAR(80),
    customs_duty_rate DECIMAL(8, 4) NOT NULL DEFAULT 0,
    customs_duty_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    other_taxes DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_customs DECIMAL(15, 2) NOT NULL DEFAULT 0,
    port_charges DECIMAL(15, 2) NOT NULL DEFAULT 0,
    transport_local DECIMAL(15, 2) NOT NULL DEFAULT 0,
    other_costs DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_landed_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    cost_per_unit DECIMAL(15, 4) NOT NULL DEFAULT 0,
    total_quantity DECIMAL(15, 4) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    order_date DATE,
    shipping_date DATE,
    arrival_date DATE,
    customs_clearance_date DATE,
    received_date DATE,
    branch_id UUID REFERENCES branches(id),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_orders_branch ON import_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_import_orders_status ON import_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_orders_number ON import_orders(order_number);

CREATE TABLE IF NOT EXISTS import_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_order_id UUID NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    description VARCHAR(255) NOT NULL DEFAULT '',
    hs_code VARCHAR(30),
    quantity DECIMAL(15, 4) NOT NULL DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'un',
    unit_price_foreign DECIMAL(15, 4) NOT NULL DEFAULT 0,
    unit_price_aoa DECIMAL(15, 4) NOT NULL DEFAULT 0,
    total_foreign DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_aoa DECIMAL(15, 2) NOT NULL DEFAULT 0,
    landed_cost_per_unit DECIMAL(15, 4) NOT NULL DEFAULT 0,
    received_quantity DECIMAL(15, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_order_items_order ON import_order_items(import_order_id);

INSERT INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '44', NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;
