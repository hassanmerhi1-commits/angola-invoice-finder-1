-- Perdas / quebras de inventário (ajustes de saída)
INSERT INTO chart_of_accounts (code, name, account_type, account_nature, level, is_header)
SELECT '6.6.1', 'Perdas e Quebras de Inventário', 'expense', 'debit', 3, false
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE code = '6.6.1');
