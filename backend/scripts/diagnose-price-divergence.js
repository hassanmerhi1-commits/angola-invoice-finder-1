#!/usr/bin/env node
/**
 * Why does one product show different prices in different branches?
 *
 *   node scripts/diagnose-price-divergence.js              # report only (read-only)
 *   node scripts/diagnose-price-divergence.js --sku ABC123 # every row of one product
 *   node scripts/diagnose-price-divergence.js --skus 102000608,106000036,155000852
 *   node scripts/diagnose-price-divergence.js --fix        # converge every SKU, clear opt-outs
 *
 * A product is stored as one row per branch. They are supposed to share the HQ price and IVA
 * unless that branch opted out (price_override / vat_override). This shows which rows disagree
 * and which ones carry an opt-out flag.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SKU_KEY = `LOWER(TRIM(CASE
    WHEN TRIM(COALESCE(p.sku, '')) = '' THEN p.id::text
    WHEN POSITION('-dup-' IN LOWER(TRIM(COALESCE(p.sku, '')))) > 0
      THEN TRIM(SUBSTRING(
        TRIM(COALESCE(p.sku, ''))
        FROM 1 FOR POSITION('-dup-' IN LOWER(TRIM(COALESCE(p.sku, '')))) - 1
      ))
    ELSE TRIM(COALESCE(p.sku, ''))
  END))`;

const ACTIVE = `COALESCE(p.is_active, TRUE)`;

function splitStatements(sql) {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.split('\n').every((line) => !line.trim() || line.trim().startsWith('--')));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }
  const db = require('../src/db');
  if (db.engine !== 'postgres') {
    console.error('This script targets the PostgreSQL server database.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const skuArgIndex = args.indexOf('--sku');
  const skuArg = skuArgIndex >= 0 ? args[skuArgIndex + 1] : null;
  const skusArgIndex = args.indexOf('--skus');
  const skuList = skusArgIndex >= 0
    ? String(args[skusArgIndex + 1] || '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : skuArg
      ? [skuArg]
      : [];

  const migration = await db.query(
    `SELECT id FROM schema_migrations WHERE id LIKE '073%'`,
  );
  console.log('');
  console.log('=== deployment ===');
  console.log('migration 073 applied :', migration.rows.length > 0 ? 'yes' : 'NO — backend did not run it');
  try {
    const meta = await db.query(`SELECT value FROM app_meta WHERE key = 'app_version' LIMIT 1`);
    console.log('app_version in DB     :', meta.rows[0]?.value || '(unset)');
  } catch {
    /* app_meta may not exist */
  }

  if (skuList.length > 0) {
    for (const sku of skuList) {
      const rows = await db.query(
        `SELECT p.id, p.sku, p.name,
                COALESCE(b.name, '(catalog / no branch)') AS branch,
                b.is_main,
                p.price, p.price2, p.price3, p.price4, p.tax_rate,
                COALESCE(p.price_override, FALSE) AS price_override,
                COALESCE(p.vat_override, FALSE) AS vat_override,
                p.is_active,
                p.updated_at
         FROM products p
         LEFT JOIN branches b ON b.id::text = p.branch_id::text
         WHERE ${SKU_KEY} = LOWER(TRIM($1))
         ORDER BY p.updated_at DESC NULLS LAST, b.is_main DESC NULLS FIRST`,
        [sku],
      );
      console.log('');
      console.log(`=== SKU "${sku}" — ${rows.rows.length} row(s) ===`);
      if (rows.rows.length === 0) {
        console.log('(no product row — will NOT appear in inventory)');
        continue;
      }
      console.table(rows.rows);
      const active = rows.rows.filter((r) => r.is_active !== false && r.is_active !== 0);
      if (active.length === 0) {
        console.log('WARNING: every row is inactive — hidden from inventory grid.');
      }
      const prices = [...new Set(active.map((r) => Number(r.price).toFixed(2)))];
      const vats = [...new Set(active.map((r) => Number(r.tax_rate).toFixed(2)))];
      if (prices.length > 1 || vats.length > 1) {
        console.log('CONFLICT: branches disagree — price variants:', prices.join(', '), '| IVA:', vats.join(', '));
        console.log('Fix: docker exec -it nexor-backend node scripts/diagnose-price-divergence.js --fix');
      }
      const newest = active.sort(
        (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
      )[0];
      if (newest) {
        console.log(
          'Grid should show (newest active row):',
          newest.branch,
          '| price',
          newest.price,
          '| IVA',
          newest.tax_rate,
          '| id',
          newest.id,
        );
      }
    }
    if (!fix) {
      console.log('');
      console.log('Read-only SKU check done. Add --fix to converge all SKUs company-wide.');
      process.exit(0);
    }
  }

  const summary = await db.query(`
    WITH keyed AS (
      SELECT ${SKU_KEY} AS sku_key,
             p.price, p.tax_rate,
             COALESCE(p.price_override, FALSE) AS price_override,
             COALESCE(p.vat_override, FALSE) AS vat_override
      FROM products p
      WHERE ${ACTIVE} AND TRIM(COALESCE(p.sku, '')) <> ''
    )
    SELECT
      COUNT(DISTINCT sku_key) AS skus,
      COUNT(*) AS rows_total,
      COUNT(*) FILTER (WHERE price_override) AS rows_price_locked,
      COUNT(*) FILTER (WHERE vat_override) AS rows_vat_locked
    FROM keyed
  `);

  const divergent = await db.query(`
    WITH keyed AS (
      SELECT ${SKU_KEY} AS sku_key, p.price, p.tax_rate
      FROM products p
      WHERE ${ACTIVE} AND TRIM(COALESCE(p.sku, '')) <> ''
    )
    SELECT
      COUNT(*) FILTER (WHERE price_variants > 1) AS skus_with_price_conflict,
      COUNT(*) FILTER (WHERE vat_variants > 1) AS skus_with_vat_conflict
    FROM (
      SELECT sku_key,
             COUNT(DISTINCT ROUND(COALESCE(price, 0)::numeric, 2)) AS price_variants,
             COUNT(DISTINCT ROUND(COALESCE(tax_rate, -1)::numeric, 2)) AS vat_variants
      FROM keyed
      GROUP BY sku_key
    ) g
  `);

  console.log('');
  console.log('=== product rows ===');
  console.table(summary.rows);
  console.log('=== how many products disagree with themselves ===');
  console.table(divergent.rows);

  const examples = await db.query(`
    WITH keyed AS (
      SELECT ${SKU_KEY} AS sku_key, p.id, p.sku, p.name, p.price, p.tax_rate,
             COALESCE(p.price_override, FALSE) AS price_override,
             COALESCE(p.vat_override, FALSE) AS vat_override,
             COALESCE(b.name, '(catalog)') AS branch
      FROM products p
      LEFT JOIN branches b ON b.id::text = p.branch_id::text
      WHERE ${ACTIVE} AND TRIM(COALESCE(p.sku, '')) <> ''
    ),
    bad AS (
      SELECT sku_key
      FROM keyed
      GROUP BY sku_key
      HAVING COUNT(DISTINCT ROUND(COALESCE(price, 0)::numeric, 2)) > 1
          OR COUNT(DISTINCT ROUND(COALESCE(tax_rate, -1)::numeric, 2)) > 1
      ORDER BY sku_key
      LIMIT 8
    )
    SELECT k.sku, k.name, k.branch, k.price, k.tax_rate, k.price_override, k.vat_override
    FROM keyed k
    JOIN bad ON bad.sku_key = k.sku_key
    ORDER BY k.sku_key, k.branch
  `);
  if (examples.rows.length > 0) {
    console.log('=== examples (first 8 products that disagree) ===');
    console.table(examples.rows);
  } else {
    console.log('No product disagrees with itself — price/IVA are already consistent per SKU.');
  }

  if (!fix) {
    console.log('');
    console.log('Read-only run. Add --fix to clear every per-branch opt-out and converge');
    console.log('all rows of a SKU onto the HQ/master price and the chosen IVA.');
    process.exit(0);
  }

  console.log('');
  console.log('=== repairing ===');
  const cleared = await db.query(`
    UPDATE products
    SET price_override = FALSE, vat_override = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE COALESCE(price_override, FALSE) OR COALESCE(vat_override, FALSE)
  `);
  console.log('per-branch opt-out flags cleared:', cleared.rowCount || 0);

  const sqlFile = path.resolve(__dirname, '../src/migrations/073_normalize_sku_price_vat.sql');
  const statements = splitStatements(fs.readFileSync(sqlFile, 'utf8'));
  for (const stmt of statements) {
    const res = await db.query(stmt);
    console.log('converged rows:', res.rowCount ?? 0);
  }

  const after = await db.query(`
    WITH keyed AS (
      SELECT ${SKU_KEY} AS sku_key, p.price, p.tax_rate
      FROM products p
      WHERE ${ACTIVE} AND TRIM(COALESCE(p.sku, '')) <> ''
    )
    SELECT
      COUNT(*) FILTER (WHERE price_variants > 1) AS skus_with_price_conflict,
      COUNT(*) FILTER (WHERE vat_variants > 1) AS skus_with_vat_conflict
    FROM (
      SELECT sku_key,
             COUNT(DISTINCT ROUND(COALESCE(price, 0)::numeric, 2)) AS price_variants,
             COUNT(DISTINCT ROUND(COALESCE(tax_rate, -1)::numeric, 2)) AS vat_variants
      FROM keyed
      GROUP BY sku_key
    ) g
  `);
  console.log('=== after repair ===');
  console.table(after.rows);
  console.log('Restart the backend (or wait 2 min) so the inventory cache drops the old rows.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
