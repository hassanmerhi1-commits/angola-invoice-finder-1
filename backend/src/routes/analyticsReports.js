// Analytics / report aggregate endpoints (SQL-side summaries)
const express = require('express');
const db = require('../db');

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = function () {
  const router = express.Router();

  /**
   * GET /sales-summary?dateFrom&dateTo&branchId
   * → { revenue, tax, transactions, byPaymentMethod, byDay:[{date,revenue,transactions}] }
   */
  router.get('/sales-summary', async (req, res) => {
    try {
      const dateFrom = String(req.query.dateFrom || '').trim().slice(0, 10);
      const dateTo = String(req.query.dateTo || '').trim().slice(0, 10);
      const branchId = String(req.query.branchId || '').trim() || null;

      if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: 'dateFrom and dateTo are required' });
      }

      const params = [`${dateFrom}T00:00:00`, dateTo];
      let branchClause = '';
      if (branchId) {
        params.push(branchId);
        branchClause = ` AND branch_id = $${params.length}`;
      }

      const endExclusive =
        db.engine === 'postgres'
          ? `created_at < ($2::date + INTERVAL '1 day')`
          : `date(created_at) <= date($2)`;

      const baseWhere = `status = 'completed' AND created_at >= $1 AND ${endExclusive}${branchClause}`;

      const [totalsRes, methodsRes, byDayRes, cnTotalsRes] = await Promise.all([
        db.query(
          `SELECT
             COALESCE(SUM(total), 0) AS revenue,
             COALESCE(SUM(tax_amount), 0) AS tax,
             COUNT(*) AS transactions
           FROM sales
           WHERE ${baseWhere}`,
          params,
        ),
        db.query(
          `SELECT payment_method, COALESCE(SUM(total), 0) AS total
           FROM sales
           WHERE ${baseWhere}
           GROUP BY payment_method`,
          params,
        ),
        db.query(
          db.engine === 'postgres'
            ? `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date,
                      COALESCE(SUM(total), 0) AS revenue,
                      COUNT(*) AS transactions
               FROM sales
               WHERE ${baseWhere}
               GROUP BY created_at::date
               ORDER BY created_at::date`
            : `SELECT date(created_at) AS date,
                      COALESCE(SUM(total), 0) AS revenue,
                      COUNT(*) AS transactions
               FROM sales
               WHERE ${baseWhere}
               GROUP BY date(created_at)
               ORDER BY date(created_at)`,
          params,
        ),
        // Net credit notes (issued) against sales totals for the same period.
        (async () => {
          try {
            const cnParams = [`${dateFrom}T00:00:00`, dateTo];
            let cnBranch = '';
            if (branchId) {
              cnParams.push(branchId);
              cnBranch = ` AND branch_id = $${cnParams.length}`;
            }
            const cnEnd =
              db.engine === 'postgres'
                ? `COALESCE(issued_at, created_at) < ($2::date + INTERVAL '1 day')`
                : `date(COALESCE(issued_at, created_at)) <= date($2)`;
            return db.query(
              `SELECT
                 COALESCE(SUM(total), 0) AS revenue,
                 COALESCE(SUM(tax_amount), 0) AS tax,
                 COUNT(*) AS notes
               FROM credit_notes
               WHERE status IN ('issued', 'transmitted')
                 AND COALESCE(issued_at, created_at) >= $1
                 AND ${cnEnd}${cnBranch}`,
              cnParams,
            );
          } catch (_) {
            return { rows: [{ revenue: 0, tax: 0, notes: 0 }] };
          }
        })(),
      ]);

      const byPaymentMethod = { cash: 0, card: 0, transfer: 0, mixed: 0, credit: 0 };
      for (const row of methodsRes.rows || []) {
        const key = String(row.payment_method || 'cash');
        if (key in byPaymentMethod) byPaymentMethod[key] = num(row.total);
        else byPaymentMethod.cash += num(row.total);
      }

      const cnRevenue = num(cnTotalsRes.rows?.[0]?.revenue);
      const cnTax = num(cnTotalsRes.rows?.[0]?.tax);
      const cnNotes = num(cnTotalsRes.rows?.[0]?.notes);

      res.set('Cache-Control', 'private, max-age=30');
      res.json({
        revenue: num(totalsRes.rows[0]?.revenue) - cnRevenue,
        tax: num(totalsRes.rows[0]?.tax) - cnTax,
        transactions: num(totalsRes.rows[0]?.transactions),
        creditNotes: cnNotes,
        creditNoteTotal: cnRevenue,
        byPaymentMethod,
        byDay: (byDayRes.rows || []).map((r) => ({
          date: String(r.date).slice(0, 10),
          revenue: num(r.revenue),
          transactions: num(r.transactions),
        })),
        netOfCreditNotes: true,
      });
    } catch (error) {
      console.error('[ANALYTICS sales-summary]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch sales summary' });
    }
  });

  return router;
};
