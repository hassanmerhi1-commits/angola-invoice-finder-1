/**
 * Phase B3 — master data pull (city → shop client).
 */
const db = require('../db');
const { activeFlagWhere } = require('../lib/sqlDialect');

async function fetchMasterDataForBranch(branchId, since) {
  if (!branchId) throw new Error('branchId obrigatório');

  const sinceClause = since ? 'AND updated_at > $2' : '';
  const productParams = since ? [branchId, since] : [branchId];
  const clientParams = since ? [branchId, since] : [branchId];

  const products = await db.query(
    `SELECT id, sku, barcode, name, category, price, price_2, price_3, price_4,
            cost, avg_cost, stock, min_stock, unit, tax_rate, branch_id, version, updated_at,
            supplier_id, supplier_name, is_active
     FROM products
     WHERE branch_id = $1 AND ${activeFlagWhere(db, 'is_active')}
     ${sinceClause}
     ORDER BY name ASC
     LIMIT 5000`,
    productParams
  );

  const clients = await db.query(
    `SELECT id, name, nif, email, phone, address, city, branch_id, version, updated_at, is_active
     FROM clients
     WHERE branch_id = $1 AND ${activeFlagWhere(db, 'is_active')}
     ${sinceClause}
     ORDER BY name ASC
     LIMIT 2000`,
    clientParams
  ).catch(() => ({ rows: [] }));

  return {
    branchId,
    since: since || null,
    generatedAt: new Date().toISOString(),
    products: products.rows,
    clients: clients.rows,
    counts: {
      products: products.rows.length,
      clients: clients.rows.length,
    },
  };
}

module.exports = { fetchMasterDataForBranch };
