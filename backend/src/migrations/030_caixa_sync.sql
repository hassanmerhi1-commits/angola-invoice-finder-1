-- Migration 030: Caixa tables for city sync (Phase B3+)

CREATE TABLE IF NOT EXISTS caixas (
    id UUID PRIMARY KEY,
    branch_id UUID REFERENCES branches(id),
    branch_name VARCHAR(255) DEFAULT '',
    name VARCHAR(255) NOT NULL DEFAULT '',
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    current_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'closed',
    petty_limit DECIMAL(15, 2) DEFAULT 0,
    daily_limit DECIMAL(15, 2) DEFAULT 0,
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    opened_by VARCHAR(255) DEFAULT '',
    closed_by VARCHAR(255) DEFAULT '',
    opened_at TIMESTAMP,
    closed_at TIMESTAMP,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS caixa_sessions (
    id UUID PRIMARY KEY,
    caixa_id UUID REFERENCES caixas(id),
    branch_id UUID REFERENCES branches(id),
    date DATE NOT NULL,
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15, 2),
    total_in DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_out DECIMAL(15, 2) NOT NULL DEFAULT 0,
    sales_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    expenses_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    adjustments DECIMAL(15, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    opened_by VARCHAR(255) DEFAULT '',
    closed_by VARCHAR(255) DEFAULT '',
    opened_at TIMESTAMP,
    closed_at TIMESTAMP,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_caixa_sessions_branch ON caixa_sessions(branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_caixas_branch ON caixas(branch_id);
