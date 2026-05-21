const crypto = require('crypto');
const db = require('../db');

async function signSaleInvoice(saleId) {
  const saleRes = await db.query('SELECT * FROM sales WHERE id = $1', [saleId]);
  if (!saleRes.rows.length) return null;
  const invoice = saleRes.rows[0];

  const prevRes = await db.query(
    `SELECT saft_hash FROM sales WHERE branch_id = $1 AND id != $2 AND saft_hash IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [invoice.branch_id, saleId]
  );
  const previousHash = prevRes.rows[0]?.saft_hash || '0';

  const canonicalString = [
    invoice.created_at,
    new Date().toISOString(),
    invoice.invoice_number,
    Number(invoice.total || 0).toFixed(2),
    previousHash,
  ].join(';');

  const hash = crypto.createHash('sha256').update(canonicalString).digest('hex');
  const shortHash = hash.substring(0, 4).toUpperCase();

  try {
    await db.query(
      `INSERT INTO invoice_signatures (invoice_id, invoice_number, signed_content_hash, algorithm)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (invoice_id) DO UPDATE SET signed_content_hash = $3`,
      [saleId, invoice.invoice_number, hash, 'SHA-256']
    );
  } catch (_) {
    /* invoice_signatures may not exist on minimal DB */
  }

  await db.query(`UPDATE sales SET saft_hash = $1 WHERE id = $2`, [shortHash, saleId]);
  return { hash, shortHash };
}

module.exports = { signSaleInvoice };
