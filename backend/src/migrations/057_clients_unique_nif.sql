-- Prevent duplicate active clients with the same NIF (retry-after-timeout safe).
-- Soft-deactivate extras first (keep oldest), then add partial unique index.

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY REPLACE(COALESCE(nif, ''), ' ', '')
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM clients
  WHERE COALESCE(is_active, true) = true
    AND TRIM(COALESCE(nif, '')) <> ''
)
UPDATE clients c
SET is_active = false,
    updated_at = CURRENT_TIMESTAMP,
    name = CASE
      WHEN c.name ILIKE '%(duplicado)%' THEN c.name
      ELSE trim(c.name) || ' (duplicado)'
    END
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_nif_active_unique
ON clients (nif)
WHERE COALESCE(is_active, true) = true AND TRIM(COALESCE(nif, '')) <> '';
