/**
 * One-time: seed opening_balance IN movements for products that have products.stock
 * but no stock_movements — prevents POS sales from zeroing stock after partial sale.
 *
 * Usage (server PC):
 *   cd C:\NEXOR ERP\backend
 *   node scripts/repair-legacy-stock-ledger.js
 */
const fs = require('fs');
const path = require('path');

const envPath = 'C:\\NEXOR ERP\\database.env';
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.DB_ENGINE = process.env.DB_ENGINE || 'postgres';

const db = require('../src/db');
const { ensureOpeningStockMovement } = require('../src/transactionEngine');

async function main() {
  const mainBranches = await db.query(
    `SELECT id FROM branches WHERE COALESCE(is_main, false) = true ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(code, ''))) = 'MAIN' THEN 0 ELSE 1 END`,
  );
  const warehouseIds = mainBranches.rows.map((r) => String(r.id));
  if (warehouseIds.length === 0) {
    console.error('No main branch found.');
    process.exit(1);
  }

  const products = await db.query(
    `SELECT id, sku, name, stock
     FROM products
     WHERE is_active IS DISTINCT FROM false AND COALESCE(stock, 0) > 0
     ORDER BY name`,
  );

  let seeded = 0;
  for (const wh of warehouseIds) {
    for (const p of products.rows) {
      const before = await db.query(
        `SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
        [p.id, wh],
      );
      if (Number(before.rows[0]?.n || 0) > 0) continue;

      await ensureOpeningStockMovement(db, p.id, wh, null);

      const after = await db.query(
        `SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
        [p.id, wh],
      );
      if (Number(after.rows[0]?.n || 0) > 0) {
        seeded += 1;
        console.log(`  + opening IN: ${p.sku || p.name} @ ${wh.slice(0, 8)}… (stock ${p.stock})`);
      }
    }
  }

  console.log(`Done. Seeded ${seeded} opening movement(s). Restart NEXOR and refresh inventory.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
