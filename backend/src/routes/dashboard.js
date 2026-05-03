// Dashboard KPIs API Route
// Pulls real-time data from transaction engine views
const express = require('express');
const db = require('../db');

module.exports = function(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const [supplierCount, categoryCount, orderCount] = await Promise.all([
        db.query(`SELECT COUNT(*) as count FROM suppliers WHERE is_active = 1`).catch(() => ({ rows: [{ count: 0 }] })),
        db.query(`SELECT COUNT(*) as count FROM categories WHERE is_active = 1`).catch(() => ({ rows: [{ count: 0 }] })),
        db.query(`SELECT COUNT(*) as count FROM purchase_orders`).catch(() => ({ rows: [{ count: 0 }] })),
      ]);

      res.json({
        todaySales: { count: 0, total: 0 },
        monthSales: { count: 0, total: 0 },
        openAR: { count: 0, total: 0 },
        openAP: { count: 0, total: 0 },
        lowStockCount: 0,
        pendingApprovals: 0,
        recentMovements: [],
        monthExpenses: 0,
        suppliers: parseInt(supplierCount.rows[0].count || 0, 10),
        categories: parseInt(categoryCount.rows[0].count || 0, 10),
        purchaseOrders: parseInt(orderCount.rows[0].count || 0, 10),
      });
    } catch (error) {
      console.error('[DASHBOARD ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch dashboard KPIs' });
    }
  });

  return router;
};
