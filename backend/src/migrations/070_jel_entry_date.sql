-- Denormalize journal date onto lines so CoA ledger can use
-- (account_id, entry_date) instead of joining/sorting the whole cash history.
ALTER TABLE journal_entry_lines
  ADD COLUMN IF NOT EXISTS entry_date DATE;

UPDATE journal_entry_lines jel
SET entry_date = je.entry_date
FROM journal_entries je
WHERE je.id = jel.journal_entry_id
  AND jel.entry_date IS NULL
  AND je.entry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jel_account_entry_date
  ON journal_entry_lines (account_id, entry_date DESC NULLS LAST);
