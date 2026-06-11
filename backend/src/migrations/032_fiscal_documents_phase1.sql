-- Phase 1 AGT fiscal foundation: item lines, transport documents, immutable sales flag

ALTER TABLE sales ADD COLUMN IF NOT EXISTS fiscal_status VARCHAR(50) DEFAULT 'issued';

UPDATE sales
SET fiscal_status = 'issued'
WHERE fiscal_status IS NULL AND status IN ('completed', 'confirmed');

CREATE TABLE IF NOT EXISTS credit_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
    product_id UUID,
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    quantity DECIMAL(15, 3) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_note_items_note ON credit_note_items(credit_note_id);

CREATE TABLE IF NOT EXISTS debit_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    debit_note_id UUID NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(15, 3) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL,
    tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_debit_note_items_note ON debit_note_items(debit_note_id);

CREATE TABLE IF NOT EXISTS transport_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_number VARCHAR(100) NOT NULL UNIQUE,
    branch_id UUID REFERENCES branches(id),
    branch_name VARCHAR(255),
    doc_type VARCHAR(50) NOT NULL CHECK (doc_type IN ('delivery', 'transfer', 'return', 'consignment')),
    origin_address TEXT,
    origin_city VARCHAR(100),
    destination_address TEXT,
    destination_city VARCHAR(100),
    destination_nif VARCHAR(50),
    destination_name VARCHAR(255),
    transporter_name VARCHAR(255),
    transporter_nif VARCHAR(50),
    vehicle_plate VARCHAR(50),
    loading_date DATE NOT NULL,
    loading_time VARCHAR(10),
    items_json JSONB NOT NULL DEFAULT '[]',
    total_weight DECIMAL(15, 3),
    total_volume DECIMAL(15, 3),
    status VARCHAR(50) DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'in_transit', 'delivered', 'cancelled')),
    related_invoice_id UUID REFERENCES sales(id),
    related_invoice_number VARCHAR(100),
    notes TEXT,
    saft_hash VARCHAR(64),
    issued_by UUID REFERENCES users(id),
    issued_at TIMESTAMP,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transport_documents_branch ON transport_documents(branch_id);
CREATE INDEX IF NOT EXISTS idx_transport_documents_status ON transport_documents(status);

DO $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
  INSERT INTO document_sequences (document_type, prefix, fiscal_year, current_number, branch_id)
  VALUES
    ('credit_note', 'NC', yr, COALESCE((SELECT COUNT(*) FROM credit_notes WHERE EXTRACT(YEAR FROM created_at) = yr), 0), ''),
    ('debit_note', 'ND', yr, COALESCE((SELECT COUNT(*) FROM debit_notes WHERE EXTRACT(YEAR FROM created_at) = yr), 0), ''),
    ('transport_document', 'GT', yr, COALESCE((SELECT COUNT(*) FROM transport_documents WHERE EXTRACT(YEAR FROM created_at) = yr), 0), '')
  ON CONFLICT (document_type, fiscal_year, branch_id) DO UPDATE
  SET current_number = GREATEST(document_sequences.current_number, EXCLUDED.current_number);
END $$;
