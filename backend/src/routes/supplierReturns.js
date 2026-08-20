// Supplier returns (purchase returns / devoluções a fornecedor)
// Prefer PurchaseReturnsTab → processTransaction (stock + AP/GL).
// This CRUD route is status/metadata only unless callers also post stock separately.
const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

function parseJsonColumn(val, fallback = []) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return val;
}

function mapRow(row) {
  const items = parseJsonColumn(row.items_json, []);
  return {
    id: row.id,
    returnNumber: row.return_number,
    branchId: row.branch_id,
    branchName: row.branch_name,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderNumber: row.purchase_order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    reason: row.reason,
    reasonDescription: row.reason_description,
    items,
    subtotal: Number(row.subtotal || 0),
    taxAmount: Number(row.tax_amount || 0),
    total: Number(row.total || 0),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at || undefined,
    shippedAt: row.shipped_at || undefined,
    completedAt: row.completed_at || undefined,
    notes: row.notes || undefined,
  };
}

function mapToDb(ret) {
  return {
    id: ret.id,
    return_number: ret.returnNumber,
    branch_id: ret.branchId,
    branch_name: ret.branchName,
    purchase_order_id: ret.purchaseOrderId,
    purchase_order_number: ret.purchaseOrderNumber,
    supplier_id: ret.supplierId || '',
    supplier_name: ret.supplierName,
    reason: ret.reason,
    reason_description: ret.reasonDescription || '',
    items_json: JSON.stringify(ret.items || []),
    subtotal: ret.subtotal,
    tax_amount: ret.taxAmount,
    total: ret.total,
    status: ret.status,
    created_by: ret.createdBy,
    approved_by: ret.approvedBy || '',
    approved_at: ret.approvedAt || '',
    shipped_at: ret.shippedAt || '',
    completed_at: ret.completedAt || '',
    notes: ret.notes || '',
  };
}

module.exports = function (broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM supplier_returns WHERE 1=1';
      const params = [];
      if (branchId) {
        query += ' AND branch_id = $1';
        params.push(branchId);
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      res.json(result.rows.map(mapRow));
    } catch (error) {
      console.error('[SUPPLIER RETURNS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch supplier returns' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM supplier_returns WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Return not found' });
      }
      res.json(mapRow(result.rows[0]));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch supplier return' });
    }
  });

  router.post('/', requirePermission('purchase_create', 'purchase_receive'), async (req, res) => {
    try {
      const body = req.body;
      const id = body.id || randomUUID();
      const row = mapToDb({ ...body, id });
      await db.query(
        `INSERT INTO supplier_returns (
          id, return_number, branch_id, branch_name, purchase_order_id, purchase_order_number,
          supplier_id, supplier_name, reason, reason_description, items_json,
          subtotal, tax_amount, total, status, created_by, created_at,
          approved_by, approved_at, shipped_at, completed_at, notes
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          COALESCE($17, CURRENT_TIMESTAMP),$18,$19,$20,$21,$22
        )`,
        [
          row.id, row.return_number, row.branch_id, row.branch_name,
          row.purchase_order_id, row.purchase_order_number, row.supplier_id, row.supplier_name,
          row.reason, row.reason_description, row.items_json,
          row.subtotal, row.tax_amount, row.total, row.status, row.created_by,
          body.createdAt || null,
          row.approved_by, row.approved_at || null, row.shipped_at || null, row.completed_at || null,
          row.notes,
        ]
      );
      const created = await db.query('SELECT * FROM supplier_returns WHERE id = $1', [id]);
      await broadcastTable('supplier_returns');
      const mapped = mapRow(created.rows[0]);
      auditErpSafe(req, {
        table: 'supplier_returns',
        id,
        action: 'create',
        description: `Devolução a fornecedor criada: ${mapped.returnNumber || id}`,
        newValues: { returnNumber: mapped.returnNumber, supplierName: mapped.supplierName, total: mapped.total, status: mapped.status },
        branchId: mapped.branchId,
      });
      res.status(201).json(mapped);
    } catch (error) {
      console.error('[SUPPLIER RETURNS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to create supplier return' });
    }
  });

  router.put('/:id', requirePermission('purchase_create', 'purchase_receive'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query('SELECT id FROM supplier_returns WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Return not found' });
      }
      const row = mapToDb({ ...req.body, id });
      await db.query(
        `UPDATE supplier_returns SET
          return_number = $2, branch_id = $3, branch_name = $4,
          purchase_order_id = $5, purchase_order_number = $6,
          supplier_id = $7, supplier_name = $8, reason = $9, reason_description = $10,
          items_json = $11, subtotal = $12, tax_amount = $13, total = $14, status = $15,
          created_by = $16, approved_by = $17, approved_at = $18, shipped_at = $19,
          completed_at = $20, notes = $21
         WHERE id = $1`,
        [
          id, row.return_number, row.branch_id, row.branch_name,
          row.purchase_order_id, row.purchase_order_number, row.supplier_id, row.supplier_name,
          row.reason, row.reason_description, row.items_json,
          row.subtotal, row.tax_amount, row.total, row.status, row.created_by,
          row.approved_by, row.approved_at || null, row.shipped_at || null, row.completed_at || null,
          row.notes,
        ]
      );
      const updated = await db.query('SELECT * FROM supplier_returns WHERE id = $1', [id]);
      await broadcastTable('supplier_returns');
      const mapped = mapRow(updated.rows[0]);
      auditErpSafe(req, {
        table: 'supplier_returns',
        id,
        action: 'update',
        description: `Devolução a fornecedor actualizada: ${mapped.returnNumber || id}`,
        newValues: { returnNumber: mapped.returnNumber, status: mapped.status, total: mapped.total },
        branchId: mapped.branchId,
      });
      res.json(mapped);
    } catch (error) {
      console.error('[SUPPLIER RETURNS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to update supplier return' });
    }
  });

  router.delete('/:id', requirePermission('admin_settings', 'purchase_create'), async (req, res) => {
    try {
      const result = await db.query('DELETE FROM supplier_returns WHERE id = $1', [req.params.id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Return not found' });
      }
      await broadcastTable('supplier_returns');
      auditErpSafe(req, {
        table: 'supplier_returns',
        id: req.params.id,
        action: 'delete',
        description: `Devolução a fornecedor eliminada: ${req.params.id}`,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete supplier return' });
    }
  });

  return router;
};
