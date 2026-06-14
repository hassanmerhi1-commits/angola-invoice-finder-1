-- Migration 043: stock_transfer_items.created_at (SQLite had it; PG 001 schema did not)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_transfer_items' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE stock_transfer_items
      ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;
