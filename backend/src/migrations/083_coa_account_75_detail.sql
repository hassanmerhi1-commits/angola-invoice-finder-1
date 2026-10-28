-- Detail under account 75. Inserts only missing codes.
-- 752 and 753 become groups. Parents are linked by code.
-- Does not deactivate customer, supplier, or till accounts.

INSERT INTO chart_of_accounts (code, name, account_type, account_nature, level, is_header, is_active)
SELECT v.code, v.name, 'expense', 'debit', v.level, v.is_header, true
FROM (VALUES
  ('75200001'::varchar, 'Água'::varchar, 3, false),
  ('75200002'::varchar, 'Electricidade'::varchar, 3, false),
  ('75200003'::varchar, 'Combustíveis e outros fluidos'::varchar, 3, false),
  ('75200004'::varchar, 'Conservação e reparação'::varchar, 3, false),
  ('75200005'::varchar, 'Material de protecção, segurança e conforto'::varchar, 3, false),
  ('75200006'::varchar, 'Ferramentas e utensílios de desgaste rápido'::varchar, 3, false),
  ('75200007'::varchar, 'Material de escritório'::varchar, 3, false),
  ('75200008'::varchar, 'Livros e documentação técnica'::varchar, 3, false),
  ('75200009'::varchar, 'Outros fornecimentos'::varchar, 3, false),
  ('75200010'::varchar, 'Comunicação'::varchar, 3, false),
  ('75200011'::varchar, 'Rendas e alugueres'::varchar, 3, false),
  ('75200012'::varchar, 'Seguros'::varchar, 3, false),
  ('75200013'::varchar, 'Deslocações e estadas'::varchar, 3, false),
  ('75200014'::varchar, 'Despesas de representação'::varchar, 3, false),
  ('75200015'::varchar, 'Conservação e reparação'::varchar, 3, false),
  ('75200016'::varchar, 'Vigilância e segurança'::varchar, 3, false),
  ('75200017'::varchar, 'Limpeza, higiene e conforto'::varchar, 3, false),
  ('75200018'::varchar, 'Publicidade e propaganda'::varchar, 3, false),
  ('75200019'::varchar, 'Contencioso e notariado'::varchar, 3, false),
  ('75200020'::varchar, 'Comissões a intermediários'::varchar, 3, false),
  ('7521'::varchar, 'Assistência técnica'::varchar, 3, true),
  ('75210001'::varchar, 'Estrangeira'::varchar, 4, false),
  ('75210002'::varchar, 'Nacional'::varchar, 4, false),
  ('75200021'::varchar, 'Trabalhos executados no exterior'::varchar, 3, false),
  ('75200022'::varchar, 'Honorários e avenças'::varchar, 3, false),
  ('75200023'::varchar, 'Royalties'::varchar, 3, false),
  ('75200024'::varchar, 'Outros serviços'::varchar, 3, false),
  ('7531'::varchar, 'Indirectos'::varchar, 3, true),
  ('75310001'::varchar, 'Imposto de selo'::varchar, 4, false),
  ('75310002'::varchar, 'IVA'::varchar, 4, false),
  ('75310003'::varchar, 'Outros impostos'::varchar, 4, false),
  ('7532'::varchar, 'Directos'::varchar, 3, true),
  ('75320001'::varchar, 'Imposto de capitais'::varchar, 4, false),
  ('75320002'::varchar, 'Contribuição predial'::varchar, 4, false),
  ('75320003'::varchar, 'Outros impostos'::varchar, 4, false)
) AS v(code, name, level, is_header)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts existing WHERE existing.code = v.code
);

UPDATE chart_of_accounts
SET is_header = true
WHERE code IN ('752', '753', '7521', '7531', '7532');

UPDATE chart_of_accounts AS child
SET parent_id = parent.id
FROM (VALUES
  ('75200001'::varchar, '752'::varchar),
  ('75200002'::varchar, '752'::varchar),
  ('75200003'::varchar, '752'::varchar),
  ('75200004'::varchar, '752'::varchar),
  ('75200005'::varchar, '752'::varchar),
  ('75200006'::varchar, '752'::varchar),
  ('75200007'::varchar, '752'::varchar),
  ('75200008'::varchar, '752'::varchar),
  ('75200009'::varchar, '752'::varchar),
  ('75200010'::varchar, '752'::varchar),
  ('75200011'::varchar, '752'::varchar),
  ('75200012'::varchar, '752'::varchar),
  ('75200013'::varchar, '752'::varchar),
  ('75200014'::varchar, '752'::varchar),
  ('75200015'::varchar, '752'::varchar),
  ('75200016'::varchar, '752'::varchar),
  ('75200017'::varchar, '752'::varchar),
  ('75200018'::varchar, '752'::varchar),
  ('75200019'::varchar, '752'::varchar),
  ('75200020'::varchar, '752'::varchar),
  ('7521'::varchar, '752'::varchar),
  ('75210001'::varchar, '7521'::varchar),
  ('75210002'::varchar, '7521'::varchar),
  ('75200021'::varchar, '752'::varchar),
  ('75200022'::varchar, '752'::varchar),
  ('75200023'::varchar, '752'::varchar),
  ('75200024'::varchar, '752'::varchar),
  ('7531'::varchar, '753'::varchar),
  ('75310001'::varchar, '7531'::varchar),
  ('75310002'::varchar, '7531'::varchar),
  ('75310003'::varchar, '7531'::varchar),
  ('7532'::varchar, '753'::varchar),
  ('75320001'::varchar, '7532'::varchar),
  ('75320002'::varchar, '7532'::varchar),
  ('75320003'::varchar, '7532'::varchar)
) AS m(code, parent_code)
JOIN chart_of_accounts AS parent ON parent.code = m.parent_code
WHERE child.code = m.code;

UPDATE chart_of_accounts
SET children_count = (
  SELECT COUNT(*)::int FROM chart_of_accounts child
  WHERE child.parent_id = chart_of_accounts.id AND child.is_active = true
)
WHERE code IN ('75', '752', '753', '7521', '7531', '7532');
