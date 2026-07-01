-- Per-branch default POS selling price level (1-4).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS price_level INTEGER DEFAULT 1;

UPDATE branches SET price_level = 1 WHERE price_level IS NULL;
