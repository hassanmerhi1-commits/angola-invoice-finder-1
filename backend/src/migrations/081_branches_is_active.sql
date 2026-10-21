-- Soft-delete flag for filiais. PG 001 created branches without is_active,
-- so DELETE / Filial was dying on "column is_active does not exist".
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

UPDATE branches SET is_active = true WHERE is_active IS NULL;
