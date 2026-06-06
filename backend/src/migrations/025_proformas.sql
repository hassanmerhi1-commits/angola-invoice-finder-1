-- Migration 025: Pro forma (quotation) documents

CREATE TABLE IF NOT EXISTS proformas (
    id UUID PRIMARY KEY,
    proforma_number VARCHAR(100) NOT NULL,
    client_id VARCHAR(64) DEFAULT '',
    client_name VARCHAR(255) NOT NULL DEFAULT '',
    client_nif VARCHAR(50) DEFAULT '',
    customer_email VARCHAR(255) DEFAULT '',
    customer_phone VARCHAR(50) DEFAULT '',
    customer_address TEXT DEFAULT '',
    branch_id VARCHAR(64) DEFAULT '',
    branch_name VARCHAR(255) DEFAULT '',
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'AOA',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    valid_until TIMESTAMP,
    notes TEXT DEFAULT '',
    terms_and_conditions TEXT DEFAULT '',
    converted_to_invoice_id VARCHAR(64) DEFAULT '',
    converted_to_invoice_number VARCHAR(100) DEFAULT '',
    converted_at TIMESTAMP,
    created_by VARCHAR(64) DEFAULT '',
    created_by_name VARCHAR(255) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proforma_items (
    id UUID PRIMARY KEY,
    proforma_id UUID NOT NULL REFERENCES proformas(id) ON DELETE CASCADE,
    product_id VARCHAR(64) DEFAULT '',
    product_name VARCHAR(255) NOT NULL DEFAULT '',
    sku VARCHAR(100) DEFAULT '',
    description TEXT DEFAULT '',
    quantity DECIMAL(15, 4) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(8, 4) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(8, 4) NOT NULL DEFAULT 14,
    tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    branch_id VARCHAR(64) DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_proformas_branch ON proformas(branch_id);
CREATE INDEX IF NOT EXISTS idx_proformas_status ON proformas(status);
CREATE INDEX IF NOT EXISTS idx_proformas_created ON proformas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proforma_items_proforma ON proforma_items(proforma_id);
