-- AGT NIF consultation: its own login (separate from invoice sending) and a cache of names AGT returned.

ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS nif_lookup_enabled BOOLEAN DEFAULT false;
ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS nif_lookup_url TEXT;
ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS nif_lookup_method TEXT DEFAULT 'GET';
ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS nif_lookup_username TEXT;
ALTER TABLE agt_config ADD COLUMN IF NOT EXISTS nif_lookup_password_encrypted TEXT;

CREATE TABLE IF NOT EXISTS nif_lookup_cache (
  nif TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  taxpayer_status TEXT,
  raw_response TEXT,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
