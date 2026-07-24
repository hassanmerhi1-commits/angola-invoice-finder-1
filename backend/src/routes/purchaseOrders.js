// Purchase Orders API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { createPurchaseOrder, processPurchaseReceive } = require('../transactionEngine');
const { requirePermission } = require('../middleware/requirePermission');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // READ: Get all purchase orders (read-only queries are fine in routes)
  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM purchase_orders';
      const params = [];
      if (branchId) { query += ' WHERE branch_id = $1'; params.push(branchId); }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);

      for (let order of result.rows) {
        const itemsResult = await db.query('SELECT * FROM purchase_order_items WHERE order_id = $1', [order.id]);
        order.items = itemsResult.rows;
      }
      res.json(result.rows);
    } catch (error) {
      console.error('[PURCHASE ORDERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch purchase orders' });
    }
  });

  /**
   * When a purchase invoice is saved with an order number, mark that PO as received
   * without running goods receipt (stock already updated by the invoice transaction).
   */
  router.post('/mark-received-from-invoice', requirePermission('purchase_receive'), async (req, res) => {
    try {
      const { orderNumber, supplierId, receivedBy } = req.body || {};
      const num = orderNumber != null ? String(orderNumber).trim() : '';
      if (!num || !supplierId) {
        return res.status(400).json({ error: 'orderNumber and supplierId are required' });
      }
      const find = await db.query(
        `SELECT id, status FROM purchase_orders
         WHERE LOWER(TRIM(COALESCE(order_number, ''))) = LOWER($1)
           AND TRIM(supplier_id::text) = TRIM($2)
         LIMIT 1`,
        [num, supplierId]
      );
      if (find.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase order not found for this supplier and order number' });
      }
      const { id: orderId, status } = find.rows[0];
      if (status === 'cancelled' || status === 'received') {
        await broadcastTable('purchase_orders');
        return res.json({ success: true, skipped: true });
      }
      await db.query(
        `UPDATE purchase_order_items SET received_quantity = quantity WHERE order_id = $1`,
        [orderId]
      );
      const rb = receivedBy != null && String(receivedBy).trim() !== '' ? String(receivedBy).trim() : null;
      try {
        if (rb) {
          await db.query(
            `UPDATE purchase_orders
             SET status = 'received',
                 received_by = $1::uuid,
                 received_at = CURRENT_TIMESTAMP,
                 freight_distributed = true
             WHERE id = $2`,
            [rb, orderId]
          );
        } else {
          await db.query(
            `UPDATE purchase_orders
             SET status = 'received',
                 received_at = CURRENT_TIMESTAMP,
                 freight_distributed = true
             WHERE id = $1`,
            [orderId]
          );
        }
      } catch (uuidErr) {
        await db.query(
          `UPDATE purchase_orders
           SET status = 'received',
               received_at = CURRENT_TIMESTAMP,
               freight_distributed = true
           WHERE id = $1`,
          [orderId]
        );
      }
      await broadcastTable('purchase_orders');
      res.json({ success: true });
    } catch (error) {
      console.error('[PURCHASE ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to mark order received' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  router.post('/', requirePermission('purchase_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await createPurchaseOrder(client, req.body);
      await client.query('COMMIT');
      await broadcastTable('purchase_orders');
      res.status(201).json(order);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PURCHASE ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to create purchase order' });
    } finally {
      client.release();
    }
  });

  // APPROVE: status + linked approval_requests (no stock/accounting impact)
  router.post('/:id/approve', requirePermission('purchase_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = req.params;
      const approvedBy = req.body?.approvedBy != null ? String(req.body.approvedBy).trim() : '';

      const orderResult = await client.query(
        'SELECT id, status, order_number FROM purchase_orders WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!orderResult.rows.length) {
        throw new Error('Ordem de compra não encontrada');
      }
      const order = orderResult.rows[0];
      if (order.status === 'received' || order.status === 'cancelled') {
        throw new Error(`Não é possível aprovar encomenda com estado: ${order.status}`);
      }
      if (order.status === 'approved') {
        await client.query('COMMIT');
        return res.json({ success: true, alreadyApproved: true });
      }

      if (approvedBy && /^[0-9a-f-]{36}$/i.test(approvedBy)) {
        try {
          await client.query(
            `UPDATE purchase_orders SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [approvedBy, id],
          );
        } catch (uuidErr) {
          if (!/invalid input syntax for type uuid/i.test(String(uuidErr.message || uuidErr))) throw uuidErr;
          await client.query(
            `UPDATE purchase_orders SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [id],
          );
        }
      } else {
        await client.query(
          `UPDATE purchase_orders SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id],
        );
      }

      try {
        const ar = await client.query(
          `SELECT id, current_step FROM approval_requests
           WHERE document_type = 'purchase_order' AND document_id = $1 AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
          [id],
        );
        if (ar.rows.length > 0) {
          const request = ar.rows[0];
          if (approvedBy && /^[0-9a-f-]{36}$/i.test(approvedBy)) {
            try {
              await client.query(
                `INSERT INTO approval_actions (request_id, step_number, action, user_id, comments)
                 VALUES ($1, $2, 'approve', $3, 'Aprovado na encomenda')`,
                [request.id, request.current_step, approvedBy],
              );
            } catch (_) {
              await client.query(
                `INSERT INTO approval_actions (request_id, step_number, action, comments)
                 VALUES ($1, $2, 'approve', 'Aprovado na encomenda')`,
                [request.id, request.current_step],
              );
            }
          } else {
            await client.query(
              `INSERT INTO approval_actions (request_id, step_number, action, comments)
               VALUES ($1, $2, 'approve', 'Aprovado na encomenda')`,
              [request.id, request.current_step],
            );
          }
          await client.query(
            `UPDATE approval_requests SET status = 'approved', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [request.id],
          );
        }
      } catch (approvalErr) {
        console.warn('[PURCHASE ORDERS] approval_requests sync skipped:', approvalErr.message);
      }

      await client.query('COMMIT');
      await broadcastTable('purchase_orders');
      if (broadcastTable) await broadcastTable('approval_requests');
      res.json({ success: true, orderNumber: order.order_number });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PURCHASE ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to approve order' });
    } finally {
      client.release();
    }
  });

  // RECEIVE: Delegated to Transaction Engine (stock + accounting)
  router.post('/:id/receive', requirePermission('purchase_receive'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = req.params;
      const { receivedBy, receivedQuantities } = req.body;

      // Check approval status
      try {
        const approvalResult = await client.query(
          `SELECT status FROM approval_requests WHERE document_type = 'purchase_order' AND document_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [id]
        );
        if (approvalResult.rows.length > 0 && approvalResult.rows[0].status !== 'approved') {
          throw new Error(`Ordem de compra aguarda aprovação (estado: ${approvalResult.rows[0].status})`);
        }
      } catch (e) {
        if (e.message.includes('aguarda aprovação')) throw e;
        // Hard-fail if approval table query fails unexpectedly (do not soft-skip).
        if (!/does not exist|no such table/i.test(String(e.message || ''))) {
          throw e;
        }
      }

      await processPurchaseReceive(client, id, receivedQuantities, receivedBy);
      await client.query('COMMIT');
      await broadcastTable('purchase_orders');
      await broadcastTable('products');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PURCHASE ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to receive order' });
    } finally {
      client.release();
    }
  });

  return router;
};
