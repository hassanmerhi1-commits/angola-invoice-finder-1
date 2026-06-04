-- Track when a sales invoice was printed (daily checklist / audit)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS printed_at TIMESTAMP WITH TIME ZONE;
