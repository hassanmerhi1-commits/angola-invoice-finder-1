/**
 * Phase B2 — submit pending local sales to AGT from shop client SQLite.
 */
const { applyAgtEnvToProcess, loadAgtEnv } = require('./agtEnv');

let transmitInvoice;
function getTransmit() {
  if (!transmitInvoice) {
    applyAgtEnvToProcess();
    transmitInvoice = require('../agt/connector').transmitInvoice;
  }
  return transmitInvoice;
}

function resolveRetryPolicy() {
  try {
    return require('../sync/retryPolicy');
  } catch {
    return {
      computeNextRetryAt: (attempts) => new Date(Date.now() + Math.min(3600000, attempts * 60000)).toISOString(),
      shouldMarkDead: (attempts) => attempts >= 12,
    };
  }
}

function refreshCityOutboxPayload(db, saleId) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) return;
  const row = db.prepare(
    `SELECT id, payload_json FROM sync_outbox
     WHERE entity_id = ? AND destination = 'CITY_SERVER' AND status IN ('pending', 'failed')
     LIMIT 1`
  ).get(saleId);
  if (!row) return;
  let payload;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return;
  }
  if (!payload.saleData) payload.saleData = {};
  payload.saleData.saftHash = sale.saft_hash;
  payload.saleData.agtStatus = sale.agt_status;
  payload.saleData.agtCode = sale.agt_code;
  db.prepare('UPDATE sync_outbox SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), row.id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} limit
 */
async function processPendingAgtSubmissions(db, limit = 5) {
  const { computeNextRetryAt, shouldMarkDead } = resolveRetryPolicy();
  const now = new Date().toISOString();
  const cfg = loadAgtEnv();

  const rows = db.prepare(
    `SELECT a.*, s.subtotal, s.tax_amount, s.total, s.customer_nif, s.customer_name,
            s.saft_hash, s.created_at, s.branch_id
     FROM agt_submissions a
     INNER JOIN sales s ON s.id = a.sale_id
     WHERE a.status IN ('pending', 'failed', 'retrying')
       AND (a.next_retry_at IS NULL OR a.next_retry_at <= ?)
     ORDER BY a.created_at ASC
     LIMIT ?`
  ).all(now, limit);

  let submitted = 0;
  let failed = 0;

  for (const row of rows) {
    db.prepare(`UPDATE agt_submissions SET status = 'submitting' WHERE id = ?`).run(row.id);

    const payload = {
      documentType: 'FT',
      invoiceNumber: row.invoice_number,
      date: row.created_at,
      customerNif: row.customer_nif || '999999990',
      customerName: row.customer_name || 'Consumidor Final',
      subtotal: parseFloat(row.subtotal) || 0,
      taxAmount: parseFloat(row.tax_amount) || 0,
      total: parseFloat(row.total) || 0,
      hash: row.saft_hash,
    };

    try {
      applyAgtEnvToProcess();
      const transmit = getTransmit();
      const result = await transmit(payload);
      const ts = new Date().toISOString();

      db.prepare(
        `UPDATE agt_submissions
         SET status = 'submitted', agt_reference = ?, response_json = ?,
             submitted_at = ?, last_error = NULL, retry_count = ?
         WHERE id = ?`
      ).run(
        result.agtCode,
        JSON.stringify(result.responsePayload || {}),
        ts,
        row.retry_count || 0,
        row.id
      );

      db.prepare(
        `UPDATE sales SET agt_status = ?, agt_code = ?, agt_validated_at = ?
         WHERE id = ?`
      ).run(result.agtStatus || 'validated', result.agtCode, result.validatedAt || ts, row.sale_id);

      refreshCityOutboxPayload(db, row.sale_id);
      submitted += 1;
    } catch (e) {
      const attempts = Number(row.retry_count || 0) + 1;
      const dead = shouldMarkDead(attempts);
      const nextRetry = computeNextRetryAt(attempts);
      db.prepare(
        `UPDATE agt_submissions
         SET status = ?, retry_count = ?, last_error = ?, next_retry_at = ?
         WHERE id = ?`
      ).run(dead ? 'dead' : 'failed', attempts, String(e.message).slice(0, 500), nextRetry, row.id);

      db.prepare(`UPDATE sales SET agt_status = ? WHERE id = ?`).run(dead ? 'dead' : 'failed', row.sale_id);
      failed += 1;
    }
  }

  return { submitted, failed, pending: getPendingAgtCount(db), simulated: cfg.AGT_SIMULATE };
}

function getPendingAgtCount(db) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM agt_submissions WHERE status IN ('pending', 'failed', 'retrying')`
  ).get();
  return Number(row?.n || 0);
}

module.exports = {
  processPendingAgtSubmissions,
  getPendingAgtCount,
  refreshCityOutboxPayload,
};
