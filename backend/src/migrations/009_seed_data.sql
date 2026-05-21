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

-- Default admin user (email: admin@kwanzaerp.ao)
INSERT INTO users (id, email, password_hash, name, role, branch_id, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'admin@kwanzaerp.ao',
  '$2a$12$eMqfxQm/5MvHdBkKV4vSj.aX3PxAyFYn08TQ25LGXFtQHL2vxBQwa',
  'Administrador',
  'admin',
  'b0000000-0000-0000-0000-000000000001',
  true
) ON CONFLICT (email) DO NOTHING;

-- Default cashier user (email: caixa1@kwanzaerp.ao)
INSERT INTO users (id, email, password_hash, name, role, branch_id, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  'caixa1@kwanzaerp.ao',
  '$2a$12$6EUte9gkI6Rhiiq6d8C.qe.xOHVQKwz6y/PfVs/yZuft4CshAlAhi',
  'Caixa 1',
  'cashier',
  'b0000000-0000-0000-0000-000000000001',
  true
) ON CONFLICT (email) DO NOTHING;

-- Sample categories
INSERT INTO categories (name, description, color, is_active) VALUES
  ('Alimentação', 'Produtos alimentares', '#22c55e', true),
  ('Bebidas', 'Bebidas alcoólicas e não-alcoólicas', '#3b82f6', true),
  ('Limpeza', 'Produtos de limpeza', '#f59e0b', true),
  ('Electrónica', 'Equipamentos electrónicos', '#8b5cf6', true)
ON CONFLICT DO NOTHING;

-- Sample products
INSERT INTO products (name, sku, barcode, category, price, cost, stock, unit, tax_rate, branch_id, is_active) VALUES
  ('Arroz 1kg', 'ARR001', '5601234000001', 'Alimentação', 850.00, 600.00, 100, 'un', 14.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Óleo Alimentar 1L', 'OLE001', '5601234000002', 'Alimentação', 1200.00, 900.00, 50, 'un', 14.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Água Mineral 1.5L', 'AGU001', '5601234000003', 'Bebidas', 350.00, 200.00, 200, 'un', 14.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Coca-Cola 330ml', 'COC001', '5601234000004', 'Bebidas', 450.00, 300.00, 150, 'un', 14.00, 'b0000000-0000-0000-0000-000000000001', true),
  ('Detergente Omo 1kg', 'DET001', '5601234000005', 'Limpeza', 2500.00, 1800.00, 75, 'un', 14.00, 'b0000000-0000-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;

-- Sample clients
INSERT INTO clients (name, nif, email, phone, address, is_active) VALUES
  ('Consumidor Final', '999999999', NULL, NULL, 'Luanda', true),
  ('Empresa ABC Lda', '5417123456', 'abc@empresa.ao', '+244 922 111 222', 'Rua Major, Luanda', true),
  ('Maria dos Santos', '001234567', 'maria@email.ao', '+244 923 333 444', 'Viana, Luanda', true)
ON CONFLICT DO NOTHING;
