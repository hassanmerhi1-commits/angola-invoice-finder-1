/* eslint-disable no-console */
/**
 * Diagnose how a sale was posted (payment method, receivable, journals).
 *
 *   docker compose exec backend node scripts/diagnose-sale-invoice.js FS-SY00-2026-00001
 */
async function main() {
  const invoiceNumber = process.argv[2];
  if (!invoiceNumber) {
    console.error('Usage: node scripts/diagnose-sale-invoice.js <invoice_number>');
    process.exit(1);
  }

  const db = require('../src/db');
  await db.initPromise;

  const saleRes = await db.query(
    'SELECT * FROM sales WHERE invoice_number = $1 LIMIT 1',
    [invoiceNumber],
  );
  const sale = saleRes.rows[0];
  if (!sale) {
    console.error(`No sale found for ${invoiceNumber}`);
    process.exit(1);
  }

  const oiRes = await db.query(
    `SELECT id, entity_type, entity_id, remaining_amount, status, is_debit, document_type
     FROM open_items WHERE document_id = $1`,
    [sale.id],
  );
  const jeRes = await db.query(
    `SELECT je.id, je.description, coa.code AS account_code, jel.debit_amount AS debit, jel.credit_amount AS credit
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
     LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE je.reference_type = 'sale' AND je.reference_id = $1
     ORDER BY je.created_at, coa.code`,
    [sale.id],
  );

  const pm = String(sale.payment_method || '').toLowerCase();
  const type = String(sale.invoice_type || '').toUpperCase();
  const paid = Number(sale.amount_paid || 0);
  const total = Number(sale.total || 0);

  console.log('\n=== SALE ===');
  console.log(JSON.stringify({
    invoice_number: sale.invoice_number,
    invoice_type: type || null,
    payment_method: pm,
    amount_paid: paid,
    total,
    client_id: sale.client_id,
    customer_name: sale.customer_name,
    customer_nif: sale.customer_nif,
    due_date: sale.due_date,
    created_at: sale.created_at,
  }, null, 2));

  console.log('\n=== OPEN ITEMS ===');
  console.log(oiRes.rows.length ? oiRes.rows : '(none)');

  console.log('\n=== JOURNAL LINES ===');
  console.log(jeRes.rows.length ? jeRes.rows : '(none)');

  console.log('\n=== VERDICT ===');
  if (pm === 'credit' && type === 'FT') {
    console.log('Posted as ON ACCOUNT (credit). Should appear in Receivables if open item exists.');
  } else if (type === 'FS' || (pm === 'cash' && paid >= total - 0.01)) {
    console.log('Posted as PAID CASH/CARD (FS/FR). Will NOT appear in Receivables.');
    console.log('If you chose A prazo in the UI, the browser/server did NOT receive paymentMethod=credit.');
  } else if (pm === 'credit' && type !== 'FT') {
    console.log('UNEXPECTED: credit payment but invoice type is not FT — investigate.');
  } else {
    console.log(`Mixed case: payment=${pm}, type=${type}, paid=${paid}/${total}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
