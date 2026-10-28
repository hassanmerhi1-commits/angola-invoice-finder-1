-- Detail under account 75 (Fornecimentos 752 and Impostos 753).
-- Posting accounts are 8 digits. A row with children stays a short group code.
-- Existing 75, 751, 754, 755, 756, 758 and 759 are left as they are.
-- Does not deactivate customer, supplier or till accounts.

INSERT INTO chart_of_accounts (code, name, account_type, account_nature, level, is_header, is_active)
VALUES
  ('75200001', 'Água', 'expense', 'debit', 3, false, true),
  ('75200002', 'Electricidade', 'expense', 'debit', 3, false, true),
  ('75200003', 'Combustíveis e outros fluidos', 'expense', 'debit', 3, false, true),
  ('75200004', 'Conservação e reparação', 'expense', 'debit', 3, false, true),
  ('75200005', 'Material de protecção, segurança e conforto', 'expense', 'debit', 3, false, true),
  ('75200006', 'Ferramentas e utensílios de desgaste rápido', 'expense', 'debit', 3, false, true),
  ('75200007', 'Material de escritório', 'expense', 'debit', 3, false, true),
  ('75200008', 'Livros e documentação técnica', 'expense', 'debit', 3, false, true),
  ('75200009', 'Outros fornecimentos', 'expense', 'debit', 3, false, true),
  ('75200010', 'Comunicação', 'expense', 'debit', 3, false, true),
  ('75200011', 'Rendas e alugueres', 'expense', 'debit', 3, false, true),
  ('75200012', 'Seguros', 'expense', 'debit', 3, false, true),
  ('75200013', 'Deslocações e estadas', 'expense', 'debit', 3, false, true),
  ('75200014', 'Despesas de representação', 'expense', 'debit', 3, false, true),
  ('75200015', 'Conservação e reparação', 'expense', 'debit', 3, false, true),
  ('75200016', 'Vigilância e segurança', 'expense', 'debit', 3, false, true),
  ('75200017', 'Limpeza, higiene e conforto', 'expense', 'debit', 3, false, true),
  ('75200018', 'Publicidade e propaganda', 'expense', 'debit', 3, false, true),
  ('75200019', 'Contencioso e notariado', 'expense', 'debit', 3, false, true),
  ('75200020', 'Comissões a intermediários', 'expense', 'debit', 3, false, true),
  ('7521', 'Assistência técnica', 'expense', 'debit', 3, true, true),
  ('75210001', 'Estrangeira', 'expense', 'debit', 4, false, true),
  ('75210002', 'Nacional', 'expense', 'debit', 4, false, true),
  ('75200021', 'Trabalhos executados no exterior', 'expense', 'debit', 3, false, true),
  ('75200022', 'Honorários e avenças', 'expense', 'debit', 3, false, true),
  ('75200023', 'Royalties', 'expense', 'debit', 3, false, true),
  ('75200024', 'Outros serviços', 'expense', 'debit', 3, false, true),
  ('7531', 'Indirectos', 'expense', 'debit', 3, true, true),
  ('75310001', 'Imposto de selo', 'expense', 'debit', 4, false, true),
  ('75310002', 'IVA', 'expense', 'debit', 4, false, true),
  ('75310003', 'Outros impostos', 'expense', 'debit', 4, false, true),
  ('7532', 'Directos', 'expense', 'debit', 3, true, true),
  ('75320001', 'Imposto de capitais', 'expense', 'debit', 4, false, true),
  ('75320002', 'Contribuição predial', 'expense', 'debit', 4, false, true),
  ('75320003', 'Outros impostos', 'expense', 'debit', 4, false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  account_type = EXCLUDED.account_type,
  account_nature = EXCLUDED.account_nature,
  level = EXCLUDED.level,
  is_header = EXCLUDED.is_header,
  is_active = true,
  updated_at = CURRENT_TIMESTAMP;

UPDATE chart_of_accounts
SET is_header = true, updated_at = CURRENT_TIMESTAMP
WHERE code IN ('752', '753');

UPDATE chart_of_accounts AS c
SET parent_id = p.id, updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('75200001', '752'),
  ('75200002', '752'),
  ('75200003', '752'),
  ('75200004', '752'),
  ('75200005', '752'),
  ('75200006', '752'),
  ('75200007', '752'),
  ('75200008', '752'),
  ('75200009', '752'),
  ('75200010', '752'),
  ('75200011', '752'),
  ('75200012', '752'),
  ('75200013', '752'),
  ('75200014', '752'),
  ('75200015', '752'),
  ('75200016', '752'),
  ('75200017', '752'),
  ('75200018', '752'),
  ('75200019', '752'),
  ('75200020', '752'),
  ('7521', '752'),
  ('75210001', '7521'),
  ('75210002', '7521'),
  ('75200021', '752'),
  ('75200022', '752'),
  ('75200023', '752'),
  ('75200024', '752'),
  ('7531', '753'),
  ('75310001', '7531'),
  ('75310002', '7531'),
  ('75310003', '7531'),
  ('7532', '753'),
  ('75320001', '7532'),
  ('75320002', '7532'),
  ('75320003', '7532')
) AS m(code, parent_code)
JOIN chart_of_accounts p ON p.code = m.parent_code
WHERE c.code = m.code;

UPDATE chart_of_accounts
SET children_count = (
  SELECT COUNT(*) FROM chart_of_accounts child
  WHERE child.parent_id = chart_of_accounts.id AND child.is_active = true
);
