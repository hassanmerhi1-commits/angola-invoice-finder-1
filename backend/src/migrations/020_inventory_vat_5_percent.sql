-- HISTORICAL: originally forced EVERY active product to 5% IVA.
-- That UPDATE must NEVER run again — applyPostgresMigrations re-executes all
-- SQL files on every backend start (no schema_migrations ledger), so the old
-- UPDATE silently wiped 14%/7%/0% after every restart/recreate.
--
-- Keep only the patch marker so older code paths stay no-ops.

CREATE TABLE IF NOT EXISTS schema_patches (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_patches (id)
VALUES ('020_inventory_vat_5')
ON CONFLICT (id) DO NOTHING;
