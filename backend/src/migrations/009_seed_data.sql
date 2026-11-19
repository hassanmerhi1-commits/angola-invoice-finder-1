-- Seed Data: Default admin user, branch, categories, and sample products
-- Default passwords (change after first login): admin = changeme, caixa1 = caixa1

-- Default branch
INSERT INTO branches (id, name, code, address, phone, is_main)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'Filial Principal',
  'FP',
  'Luanda, Angola',
  '+244 923 000 000',
  true
) ON CONFLICT (code) DO NOTHING;

-- Default admin user (email: admin@kwanzaerp.ao, password: changeme)
INSERT INTO users (id, email, password_hash, name, role, branch_id, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'admin@kwanzaerp.ao',
  '$2a$12$b2O7uSmkdR5JljEgu.lQCeHGhRrgh5LO7v2yfML7QNOz808XjWo.y',
  'Administrador',
  'admin',
  'b0000000-0000-0000-0000-000000000001',
  true
) ON CONFLICT (email) DO NOTHING;

-- Default cashier user (email: caixa1@kwanzaerp.ao, password: caixa1)
INSERT INTO users (id, email, password_hash, name, role, branch_id, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  'caixa1@kwanzaerp.ao',
  '$2a$12$DngiIU14Vp/RPbPbBTmQEuDjyi8kDStP2.UGjK/02jqzeXNGetOFu',
  'Caixa 1',
  'cashier',
  'b0000000-0000-0000-0000-000000000001',
  true
) ON CONFLICT (email) DO NOTHING;

-- Default categories (AFRIBEST list). Existing databases skip this file.
INSERT INTO categories (name, description, color, is_active) VALUES
  ('ACUCAR E SAL', '', '#6b7280', true),
  ('AGUA', '', '#6b7280', true),
  ('ANTISEPTICOS', '', '#6b7280', true),
  ('APERITIVOS', '', '#6b7280', true),
  ('ARROZ', '', '#6b7280', true),
  ('AZEITONAS E PICKLES', '', '#6b7280', true),
  ('BOLACHA', '', '#6b7280', true),
  ('CAFE E CHA', '', '#6b7280', true),
  ('CALDOS', '', '#6b7280', true),
  ('CHOCOLATE', '', '#6b7280', true),
  ('CONSERVA DE CARNE', '', '#6b7280', true),
  ('CONSERVA DE LEGUMES', '', '#6b7280', true),
  ('CONSERVA DE PEIXE', '', '#6b7280', true),
  ('DETERGENTE', '', '#6b7280', true),
  ('DISCARTAVEIS', '', '#6b7280', true),
  ('DIVERSOS', '', '#6b7280', true),
  ('FARINHA', '', '#6b7280', true),
  ('FRALDAS', '', '#6b7280', true),
  ('GUARDNAPOS E PH', '', '#6b7280', true),
  ('LEITE', '', '#6b7280', true),
  ('MAIONESE E KETCHUP', '', '#6b7280', true),
  ('MASSAS', '', '#6b7280', true),
  ('MATERIAL DE ESCRITORIO', '', '#6b7280', true),
  ('OLEO E AZEITE', '', '#6b7280', true),
  ('PASTA DENETE E ESCOVA DENTE', '', '#6b7280', true),
  ('PERFUMS', '', '#6b7280', true),
  ('PLASTICO', '', '#6b7280', true),
  ('REBUCADOS', '', '#6b7280', true),
  ('SABONETE', '', '#6b7280', true),
  ('SUMOS', '', '#6b7280', true)
ON CONFLICT DO NOTHING;

-- Sample products
INSERT INTO products (name, sku, barcode, category, price, cost, stock, unit, tax_rate, branch_id, is_active) VALUES
  ('Arroz 1kg', 'ARR001', '5601234000001', 'ARROZ', 850.00, 600.00, 100, 'un', 5.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Óleo Alimentar 1L', 'OLE001', '5601234000002', 'OLEO E AZEITE', 1200.00, 900.00, 50, 'un', 5.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Água Mineral 1.5L', 'AGU001', '5601234000003', 'AGUA', 350.00, 200.00, 200, 'un', 5.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Coca-Cola 330ml', 'COC001', '5601234000004', 'SUMOS', 450.00, 300.00, 150, 'un', 5.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Detergente Omo 1kg', 'DET001', '5601234000005', 'DETERGENTE', 2500.00, 1800.00, 75, 'un', 5.00, 'b0000000-0000-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;

-- Sample clients
INSERT INTO clients (name, nif, email, phone, address, is_active) VALUES
  ('Consumidor Final', '999999999', NULL, NULL, 'Luanda', true),
  ('Empresa ABC Lda', '5417123456', 'abc@empresa.ao', '+244 922 111 222', 'Rua Major, Luanda', true),
  ('Maria dos Santos', '001234567', 'maria@email.ao', '+244 923 333 444', 'Viana, Luanda', true)
ON CONFLICT DO NOTHING;
