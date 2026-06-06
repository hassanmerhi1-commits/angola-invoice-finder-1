// Daily checklist briefing — stock, print queue, price changes (AR/AP via /payments/checklist-dues)
const express = require('express');
const db = require('../db');
const { coalesceActiveNotZero } = require('../lib/sqlDialect');

const LOOKBACK_DAYS = 14;

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function queryLowStock(branchId) {
  const lowStockParams = [];
  let lowStockQuery = `
    SELECT id, sku, name, stock, min_stock, branch_id, unit
    FROM products
    WHERE ${coalesceActiveNotZero(db, 'is_active')}
      AND COALESCE(min_stock, 0) > 0
      AND COALESCE(stock, 0) <= COALESCE(min_stock, 0)`;
  if (branchId) {
    lowStockParams.push(branchId);
    lowStockQuery += ` AND branch_id = $${lowStockParams.length}`;
  }
  lowStockQuery += ' ORDER BY stock ASC NULLS FIRST, name ASC LIMIT 150';
  const result = await db.query(lowStockQuery, lowStockParams);
  return result.rows || [];
}

module.exports = function dailyBriefingRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const branchId = req.query.branchId ? String(req.query.branchId).trim() : '';
    const since = daysAgoIso(LOOKBACK_DAYS);
    const warnings = [];

    let lowStock = [];
    try {
      lowStock = await queryLowStock(branchId);
    } catch (error) {
      console.warn('[DAILY BRIEFING] low stock skipped:', error.message);
      warnings.push(error.message);
    }

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
        AND COALESCE(status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
        AND date >= $1`;
    if (branchId) {
      priceParams.push(branchId);
      priceQuery += ` AND (branch_id = $${priceParams.length} OR warehouse_id = $${priceParams.length})`;
    }
    priceQuery += ' ORDER BY date DESC, created_at DESC LIMIT 80';

    let unprinted = [];
    let priceChanges = [];
    try {
      const [unprintedRes, priceRes] = await Promise.all([
        db.query(unprintedQuery, unprintedParams),
        db.query(priceQuery, priceParams),
      ]);
      unprinted = unprintedRes.rows || [];
      priceChanges = priceRes.rows || [];
    } catch (error) {
      console.error('[DAILY BRIEFING]', error);
      return res.status(500).json({ error: error.message || 'Failed to load daily briefing' });
    }

    res.json({
      lowStock,
      receivables: [],
      payables: [],
      unprintedInvoices: unprinted,
      priceChanges,
      warnings: warnings.length ? warnings : undefined,
    });
  });

  return router;
};
