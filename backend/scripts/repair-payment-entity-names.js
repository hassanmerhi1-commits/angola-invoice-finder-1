#!/usr/bin/env node
/**
 * Backfill empty payments.entity_name from suppliers/clients,
 * and normalize journal_entries.reference_type payment→payment_out, receipt→payment_receipt.
 *
 * Usage: node scripts/repair-payment-entity-names.js [PAG-2026-00655]
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }
  const db = require('../src/db');
  const filter = process.argv[2] ? String(process.argv[2]).trim() : '';
  const params = filter ? [filter] : [];
  const payFilter = filter ? 'AND p.payment_number = $1' : '';
  const jePayFilter = filter
    ? 'AND reference_id IN (SELECT id FROM payments WHERE payment_number = $1)'
    : '';

  const suppliersFixed = await db.query(
    `UPDATE payments p
     SET entity_name = s.name,
         updated_at = CURRENT_TIMESTAMP
     FROM suppliers s
     WHERE p.entity_type = 'supplier'
       AND p.entity_id = s.id
       AND (p.entity_name IS NULL OR TRIM(COALESCE(p.entity_name, '')) = '')
       ${payFilter}`,
    params,
  );
  const clientsFixed = await db.query(
    `UPDATE payments p
     SET entity_name = c.name,
         updated_at = CURRENT_TIMESTAMP
     FROM clients c
     WHERE p.entity_type = 'customer'
       AND p.entity_id = c.id
       AND (p.entity_name IS NULL OR TRIM(COALESCE(p.entity_name, '')) = '')
       ${payFilter}`,
    params,
  );

  const journalsOut = await db.query(
    `UPDATE journal_entries
     SET reference_type = 'payment_out'
     WHERE LOWER(COALESCE(reference_type, '')) = 'payment'
       ${jePayFilter}`,
    params,
  );
  const journalsIn = await db.query(
    `UPDATE journal_entries
     SET reference_type = 'payment_receipt'
     WHERE LOWER(COALESCE(reference_type, '')) = 'receipt'
       ${jePayFilter}`,
    params,
  );

  const descFix = await db.query(
    `UPDATE journal_entries je
     SET description = CASE
           WHEN p.payment_type = 'receipt'
             THEN 'Recebimento ' || p.payment_number || ' - ' || COALESCE(NULLIF(TRIM(p.entity_name), ''), 'Cliente')
           ELSE 'Pagamento ' || p.payment_number || ' - ' || COALESCE(NULLIF(TRIM(p.entity_name), ''), 'Fornecedor')
         END
     FROM payments p
     WHERE je.reference_id = p.id
       AND LOWER(COALESCE(je.reference_type, '')) IN ('payment', 'payment_out', 'receipt', 'payment_receipt')
       AND NULLIF(TRIM(p.entity_name), '') IS NOT NULL
       AND (
         je.description IS NULL
         OR TRIM(je.description) = ''
         OR je.description NOT ILIKE '%' || TRIM(p.entity_name) || '%'
       )
       ${payFilter}`,
    params,
  );

  // Fix journal line descriptions that stored blank entity names
  const lineFix = await db.query(
    `UPDATE journal_entry_lines jel
     SET description = TRIM(p.entity_name)
     FROM journal_entries je
     INNER JOIN payments p ON p.id = je.reference_id
     WHERE jel.journal_entry_id = je.id
       AND LOWER(COALESCE(je.reference_type, '')) IN ('payment', 'payment_out', 'receipt', 'payment_receipt')
       AND NULLIF(TRIM(p.entity_name), '') IS NOT NULL
       AND (jel.description IS NULL OR TRIM(jel.description) = '')
       ${payFilter}`,
    params,
  );

  console.log({
    filter: filter || '(all)',
    suppliersNamed: suppliersFixed.rowCount || 0,
    clientsNamed: clientsFixed.rowCount || 0,
    journalsToPaymentOut: journalsOut.rowCount || 0,
    journalsToPaymentReceipt: journalsIn.rowCount || 0,
    descriptionsUpdated: descFix.rowCount || 0,
    blankLinesNamed: lineFix.rowCount || 0,
  });

  if (filter) {
    const check = await db.query(
      `SELECT p.payment_number, p.entity_type, p.entity_name, je.reference_type, je.description
       FROM payments p
       LEFT JOIN journal_entries je ON je.reference_id = p.id
       WHERE p.payment_number = $1`,
      [filter],
    );
    console.log('check:', check.rows);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
