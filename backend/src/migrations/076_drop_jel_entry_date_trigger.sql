-- Drop per-line trigger added in 075: extra SELECT on every invoice/journal post.
DROP TRIGGER IF EXISTS trg_jel_set_entry_date ON journal_entry_lines;
DROP FUNCTION IF EXISTS nexor_jel_set_entry_date();
