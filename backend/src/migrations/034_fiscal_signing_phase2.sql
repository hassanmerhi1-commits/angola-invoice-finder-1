-- Phase 2 AGT: RSA signing metadata + unified fiscal signature records

ALTER TABLE invoice_signatures ALTER COLUMN signature_data DROP NOT NULL;

CREATE TABLE IF NOT EXISTS fiscal_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    branch_id UUID,
    signing_key_id UUID REFERENCES signing_keys(id),
    content_hash VARCHAR(64) NOT NULL,
    previous_hash VARCHAR(64),
    signature_data TEXT,
    algorithm VARCHAR(50) NOT NULL DEFAULT 'SHA-256',
    system_entry_date TIMESTAMP,
    signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, entity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_signatures_invoice_unique ON invoice_signatures(invoice_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_signatures_entity ON fiscal_signatures(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_signatures_branch ON fiscal_signatures(branch_id);

ALTER TABLE signing_keys ADD COLUMN IF NOT EXISTS encrypted_passphrase TEXT;
ALTER TABLE signing_keys ADD COLUMN IF NOT EXISTS pfx_storage_path TEXT;
ALTER TABLE signing_keys ADD COLUMN IF NOT EXISTS subject_cn VARCHAR(255);
