// Daily Reports API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = function (broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      await db.ensureDailyReportsSchema();
      const { branchId } = req.query;
      let query = 'SELECT * FROM daily_reports';
      const params = [];

      if (branchId) {
        query += ' WHERE branch_id = $1';
        params.push(branchId);
      }

      query += ' ORDER BY date DESC';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('[DAILY REPORTS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch daily reports' });
    }
  });

  router.post('/generate', requirePermission('reports_daily'), async (req, res) => {
    try {
      await db.ensureDailyReportsSchema();
      const { branchId, date } = req.body || {};
      if (!branchId || !date) {
        return res.status(400).json({ error: 'branchId and date are required' });
      }

      const branchResult = await db.query('SELECT * FROM branches WHERE id = $1', [branchId]);
      const branch = branchResult.rows[0];

      const salesResult = await db.query(
        `SELECT
          COUNT(*) AS transaction_count,
          COALESCE(SUM(total), 0) AS total_sales,
          COALESCE(SUM(tax_amount), 0) AS tax_collected,
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
          COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_total,
          COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total ELSE 0 END), 0) AS transfer_total
         FROM sales
         WHERE branch_id = $1 AND date(created_at) = $2 AND status = 'completed'`,
        [branchId, date]
      );

      const stats = salesResult.rows[0] || {};
      const totalSales = num(stats.total_sales);
      const totalTransactions = num(stats.transaction_count);
      const cashTotal = num(stats.cash_total);
      const cardTotal = num(stats.card_total);
      const transferTotal = num(stats.transfer_total);
      const taxCollected = num(stats.tax_collected);
      const branchName = branch?.name || '';

      const existing = await db.query(
        'SELECT id FROM daily_reports WHERE date = $1 AND branch_id = $2',
        [date, branchId]
      );

      let result;
      if (existing.rows[0]?.id) {
        result = await db.query(
          `UPDATE daily_reports
           SET branch_name = $2, total_sales = $3, total_transactions = $4,
               cash_total = $5, card_total = $6, transfer_total = $7,
               tax_collected = $8, closing_balance = $9
           WHERE id = $1
           RETURNING *`,
          [
            existing.rows[0].id,
            branchName,
            totalSales,
            totalTransactions,
            cashTotal,
            cardTotal,
            transferTotal,
            taxCollected,
            cashTotal,
          ]
        );
      } else {
        result = await db.query(
          `INSERT INTO daily_reports (
             date, branch_id, branch_name, total_sales, total_transactions,
             cash_total, card_total, transfer_total, tax_collected, closing_balance, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
           RETURNING *`,
          [
            date,
            branchId,
            branchName,
            totalSales,
            totalTransactions,
            cashTotal,
            cardTotal,
            transferTotal,
            taxCollected,
            cashTotal,
          ]
        );
      }

      await broadcastTable('daily_reports');
      const report = result.rows[0];
      auditErpSafe(req, {
        table: 'daily_reports',
        id: report?.id,
        action: existing.rows[0]?.id ? 'update' : 'create',
        description: `Relatório diário gerado: ${date} (${branchName || branchId})`,
        newValues: { date, branchId, totalSales, totalTransactions },
        branchId,
      });
      res.json(report);
    } catch (error) {
      console.error('[DAILY REPORTS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to generate report' });
    }
  });

  router.post('/:id/close', requirePermission('reports_close'), async (req, res) => {
    try {
      await db.ensureDailyReportsSchema();
      const { id } = req.params;
      const { closingBalance, notes, closedBy } = req.body;

      const closedAt = db.engine === 'postgres'
        ? 'CURRENT_TIMESTAMP'
        : "datetime('now')";

      const result = await db.query(
        `UPDATE daily_reports
         SET status = 'closed', closing_balance = $1, notes = $2, closed_by = $3, closed_at = ${closedAt}
         WHERE id = $4 RETURNING *`,
        [closingBalance, notes || '', closedBy, id]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Report not found' });
      }

      await broadcastTable('daily_reports');
      auditErpSafe(req, {
        table: 'daily_reports',
        id,
        action: 'close',
        description: `Dia fechado: ${result.rows[0].date || id}`,
        newValues: { status: 'closed', closingBalance, notes: notes || '' },
        branchId: result.rows[0].branch_id,
      });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[DAILY REPORTS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to close day' });
    }
  });

  return router;
};
