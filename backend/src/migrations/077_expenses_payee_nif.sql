-- Payee tax id on operating expenses (POS petty cash and Despesas).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payee_nif VARCHAR(32);
