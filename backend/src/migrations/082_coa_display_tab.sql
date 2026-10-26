-- Display-only COA tab placement. Moving a parent here also moves its children
-- in the UI without changing codes or account_type on the books.
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS display_tab VARCHAR(32);
