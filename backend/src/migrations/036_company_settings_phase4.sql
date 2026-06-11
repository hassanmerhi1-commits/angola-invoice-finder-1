-- Phase 4: server-side company settings for SAF-T header

CREATE TABLE IF NOT EXISTS company_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    settings_json JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO company_settings (id, settings_json)
VALUES ('default', '{}')
ON CONFLICT (id) DO NOTHING;
