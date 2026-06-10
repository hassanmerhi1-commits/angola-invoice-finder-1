-- Migration 031: Persist freight / landing costs on purchase invoices

ALTER TABLE purchase_invoices
ADD COLUMN IF NOT EXISTS freight_cost DECIMAL(15, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS freight_other_costs DECIMAL(15, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS freight_source_account TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS freight_source_name TEXT DEFAULT '';
