-- AGT Facturação Electrónica (homologation): Basic Auth username, ATCUD, request id.

ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS api_username TEXT;
ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS iva_exemption_code TEXT;
ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS eac_code TEXT;

ALTER TABLE agt_transmissions ADD COLUMN IF NOT EXISTS request_id TEXT;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS atcud TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS agt_request_id TEXT;

ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS atcud TEXT;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS agt_request_id TEXT;

ALTER TABLE debit_notes ADD COLUMN IF NOT EXISTS atcud TEXT;
ALTER TABLE debit_notes ADD COLUMN IF NOT EXISTS agt_request_id TEXT;
