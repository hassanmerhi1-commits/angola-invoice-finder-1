// Budget & Cost Center API Routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { recomputeBudgetActuals } = require('../lib/budgetActuals');
const { auditErpSafe } = require('../lib/erpAudit');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // ===== COST CENTERS =====
  router.get('/cost-centers', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM cost_centers ORDER BY code');
      res.json(result.rows);
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch cost centers' });
    }
  });

  router.post('/cost-centers', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { code, name, parentId, branchId, managerId, description } = req.body;
      const result = await db.query(
        `INSERT INTO cost_centers (code, name, parent_id, branch_id, manager_id, description)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [code, name, parentId, branchId, managerId, description]
      );
      broadcastTable('cost_centers');
      const created = result.rows[0];
      auditErpSafe(req, {
        table: 'cost_centers',
        id: created?.id,
        action: 'create',
        description: `Centro de custo criado: ${code} ${name || ''}`.trim(),
        newValues: { code, name, branchId },
        branchId,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to create cost center' });
    }
  });

  router.put('/cost-centers/:id', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { name, description, isActive, managerId } = req.body;
      const result = await db.query(
        `UPDATE cost_centers SET name = COALESCE($1, name), description = COALESCE($2, description),
         is_active = COALESCE($3, is_active), manager_id = COALESCE($4, manager_id) WHERE id = $5 RETURNING *`,
        [name, description, isActive, managerId, req.params.id]
      );
      broadcastTable('cost_centers');
      auditErpSafe(req, {
        table: 'cost_centers',
        id: req.params.id,
        action: 'update',
        description: `Centro de custo actualizado: ${result.rows[0]?.code || req.params.id}`,
        newValues: { name, isActive, managerId },
      });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to update cost center' });
    }
  });

  // ===== BUDGETS =====
  router.get('/budgets', async (req, res) => {
    try {
      const { year, month, costCenterId } = req.query;
      try {
        await recomputeBudgetActuals(db, {
          year: year || undefined,
          month: month || undefined,
          costCenterId: costCenterId || undefined,
        });
      } catch (recomputeErr) {
        console.warn('[BUDGET] actuals recompute skipped:', recomputeErr.message);
      }

      const params = [];
      const conditions = [];

      if (year) { params.push(year); conditions.push(`b.period_year = $${params.length}`); }
      if (month) { params.push(month); conditions.push(`b.period_month = $${params.length}`); }
      if (costCenterId) { params.push(costCenterId); conditions.push(`b.cost_center_id = $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await db.query(
        `SELECT b.*, cc.code as cost_center_code, cc.name as cost_center_name,
         CASE WHEN b.budget_amount > 0 THEN ROUND((b.actual_amount / b.budget_amount * 100)::numeric, 1) ELSE 0 END as utilization_pct
         FROM budgets b JOIN cost_centers cc ON cc.id = b.cost_center_id
         ${where} ORDER BY cc.code, b.period_month`,
        params
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch budgets' });
    }
  });

  router.post('/budgets/recompute', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { year, month, costCenterId } = req.body || {};
      const result = await recomputeBudgetActuals(db, { year, month, costCenterId });
      broadcastTable('budgets');
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to recompute budget actuals' });
    }
  });

  router.post('/budgets', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { costCenterId, accountCode, periodYear, periodMonth, budgetAmount, notes } = req.body;
      const result = await db.query(
        `INSERT INTO budgets (cost_center_id, account_code, period_year, period_month, budget_amount, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cost_center_id, account_code, period_year, period_month) 
         DO UPDATE SET budget_amount = $5, notes = $6
         RETURNING *`,
        [costCenterId, accountCode, periodYear, periodMonth, budgetAmount, notes]
      );
      broadcastTable('budgets');
      const row = result.rows[0];
      auditErpSafe(req, {
        table: 'budgets',
        id: row?.id,
        action: 'update',
        description: `Orçamento ${periodYear}/${periodMonth} conta ${accountCode}: ${budgetAmount}`,
        newValues: { costCenterId, accountCode, periodYear, periodMonth, budgetAmount },
      });
      res.status(201).json(row);
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to create/update budget' });
    }
  });

  // Budget summary view
  router.get('/summary', async (req, res) => {
    try {
      const { year } = req.query;
      const y = year || new Date().getFullYear();
      try {
        await recomputeBudgetActuals(db, { year: y });
      } catch (recomputeErr) {
        console.warn('[BUDGET] summary actuals recompute skipped:', recomputeErr.message);
      }
      const result = await db.query(
        `SELECT * FROM v_budget_summary WHERE period_year = $1`,
        [y]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[BUDGET ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch budget summary' });
    }
  });

  return router;
};
