-- CoA leaf movements: backfill line dates so (account_id, entry_date) can serve LIMIT 50.
UPDATE journal_entry_lines jel
SET entry_date = je.entry_date
FROM journal_entries je
WHERE je.id = jel.journal_entry_id
  AND jel.entry_date IS NULL
  AND je.entry_date IS NOT NULL;

CREATE OR REPLACE FUNCTION nexor_jel_set_entry_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entry_date IS NULL AND NEW.journal_entry_id IS NOT NULL THEN
    SELECT je.entry_date INTO NEW.entry_date
    FROM journal_entries je
    WHERE je.id = NEW.journal_entry_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jel_set_entry_date ON journal_entry_lines;
CREATE TRIGGER trg_jel_set_entry_date
  BEFORE INSERT OR UPDATE OF journal_entry_id, entry_date
  ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION nexor_jel_set_entry_date();

CREATE INDEX IF NOT EXISTS idx_jel_account_entry_date
  ON journal_entry_lines (account_id, entry_date DESC NULLS LAST);

ANALYZE journal_entry_lines;
