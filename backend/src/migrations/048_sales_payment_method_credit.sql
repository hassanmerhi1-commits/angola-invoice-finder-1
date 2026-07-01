-- Allow on-account (credit) POS sales and align payment_method CHECK with the app.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS chk_sales_payment_method;

ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash', 'card', 'transfer', 'cheque', 'mixed', 'credit'));
