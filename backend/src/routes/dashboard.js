// Dashboard KPIs API Route
const express = require('express');
const db = require('../db');

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = function () {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
      const today = new Date().toISOString().split('T')[0];
      const monthStart = `${today.slice(0, 7)}-01`;

      // Range predicates on created_at (not date(created_at)) keep indexes usable,
      // and all KPI queries run in parallel — this endpoint gates first Dashboard paint.
      const emptyCount = () => ({ rows: [{ count: 0, total: 0 }] });
      const [
        todaySales,
        monthSales,
        arResult,
        apResult,
        lowStock,
        supplierCount,
        categoryCount,
        orderCount,
      ] = await Promise.all([
        db.query(
          branchId
            ? `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
               FROM sales
               WHERE created_at >= $1 AND status = 'completed' AND branch_id = $2`
            : `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
               FROM sales
               WHERE created_at >= $1 AND status = 'completed'`,
          branchId ? [today, branchId] : [today]
        ).catch(emptyCount),
        db.query(
          branchId
            ? `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
               FROM sales
               WHERE created_at >= $1 AND status = 'completed' AND branch_id = $2`
            : `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
               FROM sales
               WHERE created_at >= $1 AND status = 'completed'`,
          branchId ? [monthStart, branchId] : [monthStart]
        ).catch(emptyCount),
        db.query(
          // Open items are written with entity_type='customer' (never 'client').
          branchId
            ? `SELECT COUNT(*) AS count,
                      COALESCE(SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END), 0) AS total
               FROM open_items
               WHERE entity_type = 'customer' AND status != 'cleared' AND remaining_amount > 0.01 AND branch_id = $1`
            : `SELECT COUNT(*) AS count,
                      COALESCE(SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END), 0) AS total
               FROM open_items
               WHERE entity_type = 'customer' AND status != 'cleared' AND remaining_amount > 0.01`,
          branchId ? [branchId] : []
        ).catch(emptyCount),
        db.query(
          branchId
            ? `SELECT COUNT(*) AS count,
                      COALESCE(SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END), 0) AS total
               FROM open_items
               WHERE entity_type = 'supplier' AND status != 'cleared' AND remaining_amount > 0.01 AND branch_id = $1`
            : `SELECT COUNT(*) AS count,
                      COALESCE(SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END), 0) AS total
               FROM open_items
               WHERE entity_type = 'supplier' AND status != 'cleared' AND remaining_amount > 0.01`,
          branchId ? [branchId] : []
        ).catch(emptyCount),
        db.query(
          branchId
            ? `SELECT COUNT(*) AS count FROM products
               WHERE is_active = 1 AND min_stock > 0 AND stock <= min_stock AND branch_id = $1`
            : `SELECT COUNT(*) AS count FROM products
               WHERE is_active = 1 AND min_stock > 0 AND stock <= min_stock`,
          branchId ? [branchId] : []
        ).catch(emptyCount),
        db.query('SELECT COUNT(*) AS count FROM suppliers WHERE is_active = 1').catch(emptyCount),
        db.query('SELECT COUNT(*) AS count FROM categories WHERE is_active = 1').catch(emptyCount),
        db.query('SELECT COUNT(*) AS count FROM purchase_orders').catch(emptyCount),
      ]);

      const openAR = {
        count: num(arResult.rows[0]?.count),
        total: num(arResult.rows[0]?.total),
      };
      const openAP = {
        count: num(apResult.rows[0]?.count),
        total: num(apResult.rows[0]?.total),
      };
      const lowStockCount = num(lowStock.rows[0]?.count);

      res.set('Cache-Control', 'private, max-age=30');
      res.json({
        todaySales: {
          count: num(todaySales.rows[0]?.count),
          total: num(todaySales.rows[0]?.total),
        },
        monthSales: {
          count: num(monthSales.rows[0]?.count),
          total: num(monthSales.rows[0]?.total),
        },
        openAR,
        openAP,
        lowStockCount,
        pendingApprovals: 0,
        recentMovements: [],
        monthExpenses: 0,
        suppliers: parseInt(supplierCount.rows[0]?.count || 0, 10),
        categories: parseInt(categoryCount.rows[0]?.count || 0, 10),
        purchaseOrders: parseInt(orderCount.rows[0]?.count || 0, 10),
      });
    } catch (error) {
      console.error('[DASHBOARD ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dashboard KPIs' });
    }
  });

  return router;
};
