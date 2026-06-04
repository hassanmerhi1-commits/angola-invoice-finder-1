-- Sales invoice payment due date (vencimento)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date DATE;
