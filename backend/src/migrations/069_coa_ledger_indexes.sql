-- Faster CoA ledger drill-down: date-ordered journal lookups for account lines.
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_created
  ON journal_entries (entry_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account_entry
  ON journal_entry_lines (account_id, journal_entry_id);
