-- Phase 3 AGT: API configuration + generic document transmission

CREATE TABLE IF NOT EXISTS agt_config (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
    api_url TEXT,
    api_key_encrypted TEXT,
    status_url TEXT,
    company_nif VARCHAR(50),
    software_certificate_number VARCHAR(100),
    simulate BOOLEAN NOT NULL DEFAULT true,
    auto_transmit BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO agt_config (id, environment, simulate, auto_transmit)
VALUES ('default', 'sandbox', true, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE agt_transmissions ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE agt_transmissions ADD COLUMN IF NOT EXISTS entity_id UUID;

UPDATE agt_transmissions
SET entity_type = COALESCE(entity_type, transmission_type),
    entity_id = COALESCE(entity_id, invoice_id)
WHERE entity_type IS NULL OR entity_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_agt_transmissions_entity ON agt_transmissions(entity_type, entity_id);

ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS agt_validated_at TIMESTAMP;
ALTER TABLE debit_notes ADD COLUMN IF NOT EXISTS agt_validated_at TIMESTAMP;
