-- Expenses and other operational docs use non-UUID ids (exp_*, bank_*, etc.).
-- journal_entries.reference_id must accept TEXT, not UUID only.
ALTER TABLE journal_entries
  ALTER COLUMN reference_id TYPE TEXT USING reference_id::text;
