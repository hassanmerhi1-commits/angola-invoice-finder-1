-- Per-branch selling price override: when true, HQ/Sede price cascade skips this row.
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_override BOOLEAN NOT NULL DEFAULT FALSE;
