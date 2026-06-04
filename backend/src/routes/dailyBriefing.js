// Daily checklist briefing — aggregated alerts for the startup dialog
const express = require('express');
const db = require('../db');

const LOOKBACK_DAYS = 14;

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = function dailyBriefingRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const branchId = req.query.branchId ? String(req.query.branchId).trim() : '';
      const since = daysAgoIso(LOOKBACK_DAYS);

      const lowStockParams = [];
      let lowStockQuery = `
        SELECT id, sku, name, stock, min_stock, branch_id, unit
        FROM products
        WHERE COALESCE(is_active, 1) != 0
          AND COALESCE(min_stock, 0) > 0
          AND COALESCE(stock, 0) <= COALESCE(min_stock, 0)`;
      if (branchId) {
        lowStockParams.push(branchId);
        lowStockQuery += ` AND branch_id = $${lowStockParams.length}`;
      }
      lowStockQuery += ' ORDER BY stock ASC NULLS FIRST, name ASC LIMIT 150';

      const receivablesQuery = `
        SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
               oi.remaining_amount, c.name AS client_name
        FROM open_items oi
        INNER JOIN clients c ON c.id = oi.entity_id
        WHERE oi.entity_type = 'customer'
          AND (oi.is_debit = 1 OR oi.is_debit = TRUE)
          AND oi.status != 'cleared'
          AND oi.remaining_amount > 0.01
        ORDER BY oi.due_date ASC NULLS LAST, c.name, oi.document_date ASC
        LIMIT 200`;

      const payablesQuery = `
        SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
               oi.remaining_amount, s.name AS supplier_name
        FROM open_items oi
        INNER JOIN suppliers s ON s.id = oi.entity_id
        WHERE oi.entity_type = 'supplier'
          AND (oi.is_debit = 1 OR oi.is_debit = TRUE)
          AND oi.status != 'cleared'
          AND oi.remaining_amount > 0.01
        ORDER BY oi.due_date ASC NULLS LAST, s.name, oi.document_date ASC
        LIMIT 200`;

      const unprintedParams = [since];
      let unprintedQuery = `
        SELECT id, invoice_number, customer_name, total, created_at, branch_id
        FROM sales
        WHERE status = 'completed'
          AND (printed_at IS NULL OR TRIM(COALESCE(printed_at, '')) = '')
          AND date(created_at) >= date($1)`;
      if (branchId) {
        unprintedParams.push(branchId);
        unprintedQuery += ` AND branch_id = $${unprintedParams.length}`;
      }
      unprintedQuery += ' ORDER BY created_at DESC LIMIT 80';

      const priceParams = [since];
      let priceQuery = `
        SELECT id, invoice_number, supplier_name, date, total, change_price
        FROM purchase_invoices
        WHERE (change_price = 1 OR change_price = TRUE)
          AND COALESCE(status, 'confirmed') NOT IN ('cancelled', 'voided')
          AND date >= $1`;
      if (branchId) {
        priceParams.push(branchId);
        priceQuery += ` AND (branch_id = $${priceParams.length} OR warehouse_id = $${priceParams.length})`;
      }
      priceQuery += ' ORDER BY date DESC, created_at DESC LIMIT 80';

      const [lowStock, receivables, payables, unprinted, priceChanges] = await Promise.all([
        db.query(lowStockQuery, lowStockParams),
        db.query(receivablesQuery),
        db.query(payablesQuery),
        db.query(unprintedQuery, unprintedParams),
        db.query(priceQuery, priceParams),
      ]);

      res.json({
        lowStock: lowStock.rows || [],
        receivables: receivables.rows || [],
        payables: payables.rows || [],
        unprintedInvoices: unprinted.rows || [],
        priceChanges: priceChanges.rows || [],
      });
    } catch (error) {
      console.error('[DAILY BRIEFING]', error);
      res.status(500).json({ error: error.message || 'Failed to load daily briefing' });
    }
  });

  return router;
};
