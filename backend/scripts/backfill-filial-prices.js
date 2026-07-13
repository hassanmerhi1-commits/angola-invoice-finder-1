#!/usr/bin/env node
/** One-shot: backfill selling price + cost for filial products that have stock but price/cost 0. */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }
  const db = require('../src/db');
  const { ensureFilialProductsForWarehouse } = require('../src/lib/filialStockRepair');
  const branchArg = process.argv[2] || 'SY05';
  const branches = await db.query(
    `SELECT id::text AS id, name, code FROM branches
     WHERE id::text = $1 OR lower(code) = lower($1) OR lower(name) = lower($1)
     LIMIT 1`,
    [branchArg],
  );
  const b = branches.rows[0];
  if (!b) {
    console.error('Branch not found:', branchArg);
    process.exit(1);
  }
  console.log(`Backfilling prices for ${b.name} (${b.id})…`);
  const stats = await ensureFilialProductsForWarehouse(b.id);
  console.log(stats);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
