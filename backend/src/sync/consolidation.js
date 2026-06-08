/**
 * Phase B4 — HQ financial consolidation from mirrored city data.
 */
const db = require('../db');

function defaultPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
}

async function buildConsolidationReport(opts = {}) {
  const { startDate, endDate } = { ...defaultPeriod(), ...opts };
  const params = [startDate, endDate];

  const salesByBranch = await db.query(
    `SELECT COALESCE(branch_id::text, 'unknown') AS branch_id,
            COUNT(*)::int AS sale_count,
            COALESCE(SUM(total), 0)::numeric AS sales_total
     FROM sales
     WHERE status = 'completed'
       AND date(created_at) >= date($1)
       AND date(created_at) <= date($2)
     GROUP BY branch_id
     ORDER BY sales_total DESC`,
    params
  ).catch(() => ({ rows: [] }));

  const paymentsByBranch = await db.query(
    `SELECT COALESCE(branch_id::text, 'unknown') AS branch_id,
            COUNT(*)::int AS payment_count,
            COALESCE(SUM(amount), 0)::numeric AS payments_total
     FROM payments
     WHERE date(COALESCE(posted_at, created_at)) >= date($1)
       AND date(COALESCE(posted_at, created_at)) <= date($2)
     GROUP BY branch_id
     ORDER BY payments_total DESC`,
    params
  ).catch(() => ({ rows: [] }));

  const purchasesByBranch = await db.query(
    `SELECT COALESCE(NULLIF(branch_id, ''), NULLIF(warehouse_id, ''), 'unknown') AS branch_id,
            COUNT(*)::int AS purchase_count,
            COALESCE(SUM(total), 0)::numeric AS purchases_total
     FROM purchase_invoices
     WHERE COALESCE(status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
       AND date >= date($1)
       AND date <= date($2)
     GROUP BY COALESCE(NULLIF(branch_id, ''), NULLIF(warehouse_id, ''), 'unknown')
     ORDER BY purchases_total DESC`,
    params
  ).catch(() => ({ rows: [] }));

  const journalsByBranch = await db.query(
    `SELECT COALESCE(branch_id::text, 'unknown') AS branch_id,
            COUNT(*)::int AS journal_count,
            COALESCE(SUM(total_debit), 0)::numeric AS debit_total,
            COALESCE(SUM(total_credit), 0)::numeric AS credit_total
     FROM journal_entries
     WHERE date(entry_date) >= date($1)
       AND date(entry_date) <= date($2)
     GROUP BY branch_id
     ORDER BY debit_total DESC`,
    params
  ).catch(() => ({ rows: [] }));

  let recentHqIngest = [];
  try {
    const r = await db.query(
      `SELECT idempotency_key, event_type, branch_id, entity_id, created_at
       FROM hq_ingest_log ORDER BY created_at DESC LIMIT 20`
    );
    recentHqIngest = r.rows;
  } catch {
    /* pre-migration */
  }

  const totals = {
    sales: salesByBranch.rows.reduce((s, r) => s + Number(r.sales_total || 0), 0),
    payments: paymentsByBranch.rows.reduce((s, r) => s + Number(r.payments_total || 0), 0),
    purchases: purchasesByBranch.rows.reduce((s, r) => s + Number(r.purchases_total || 0), 0),
    journals: journalsByBranch.rows.reduce((s, r) => s + Number(r.journal_count || 0), 0),
    journalDebit: journalsByBranch.rows.reduce((s, r) => s + Number(r.debit_total || 0), 0),
  };

  return {
    period: { startDate, endDate },
    totals,
    salesByBranch: salesByBranch.rows,
    paymentsByBranch: paymentsByBranch.rows,
    purchasesByBranch: purchasesByBranch.rows,
    journalsByBranch: journalsByBranch.rows,
    recentHqIngest,
  };
}

module.exports = { buildConsolidationReport };
