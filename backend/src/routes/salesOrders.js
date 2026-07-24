// Sales orders API routes (cloned from proformas pattern)
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');

const MUTATE_PERMS = ['invoice_create', 'proforma_create'];
const ACTIVE_STATUSES = ['draft', 'confirmed', 'reserved'];
const { getStock } = require('../transactionEngine');

function newId() {
  return crypto.randomUUID();
}

/**
 * Soft holds: sum reserved_qty on other open reserved orders at the same stock location.
 * Stock ledger still keys warehouse_id = branch id today.
 */
async function getOpenReservedQty(productId, branchId, excludeOrderId) {
  if (!productId || !branchId) return 0;
  const r = await db.query(
    `SELECT COALESCE(SUM(i.reserved_qty), 0) AS qty
     FROM sales_order_items i
     INNER JOIN sales_orders o ON o.id = i.sales_order_id
     WHERE o.status = 'reserved'
       AND o.id <> $1
       AND CAST(o.branch_id AS TEXT) = CAST($2 AS TEXT)
       AND CAST(i.product_id AS TEXT) = CAST($3 AS TEXT)
       AND COALESCE(i.reserved_qty, 0) > 0`,
    [excludeOrderId, String(branchId), String(productId)],
  );
  return Number(r.rows[0]?.qty || 0);
}

async function clearReservedQty(clientOrDb, orderId) {
  await clientOrDb.query(
    `UPDATE sales_order_items SET reserved_qty = 0 WHERE sales_order_id = $1`,
    [orderId],
  );
}

/**
 * Ensure on-hand stock covers this order after other soft holds.
 * Throws Error with statusCode 409 on shortfall.
 */
async function assertSoftReserveAvailable(orderRow, items) {
  const branchId = String(orderRow.branch_id || '').trim();
  if (!branchId) {
    const err = new Error('Branch is required to reserve stock');
    err.statusCode = 400;
    throw err;
  }
  const shortfalls = [];
  for (const item of items || []) {
    const productId = String(item.product_id || '').trim();
    const need = Number(item.quantity) || 0;
    if (!productId || need <= 0) continue;
    const onHand = await getStock(productId, branchId);
    const otherHeld = await getOpenReservedQty(productId, branchId, orderRow.id);
    const available = onHand - otherHeld;
    if (available + 1e-9 < need) {
      shortfalls.push({
        productId,
        productName: item.product_name || productId,
        need,
        onHand,
        otherHeld,
        available: Math.max(0, available),
      });
    }
  }
  if (shortfalls.length) {
    const detail = shortfalls
      .map((s) => `${s.productName}: need ${s.need}, available ${s.available}`)
      .join('; ');
    const err = new Error(`Insufficient stock to reserve — ${detail}`);
    err.statusCode = 409;
    err.shortfalls = shortfalls;
    throw err;
  }
}

function mapItemRow(row) {
  return {
    id: row.id,
    productId: row.product_id || '',
    productName: row.product_name || '',
    sku: row.sku || '',
    description: row.description || '',
    quantity: Number(row.quantity) || 0,
    reservedQty: Number(row.reserved_qty) || 0,
    shippedQty: Number(row.shipped_qty) || 0,
    unitPrice: Number(row.unit_price) || 0,
    discount: Number(row.discount) || 0,
    taxRate: Number(row.tax_rate) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    subtotal: Number(row.subtotal) || 0,
    total: Number(row.total) || 0,
  };
}

function mapSalesOrderRow(row, items = []) {
  return {
    id: row.id,
    orderNumber: row.order_number || '',
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
    warehouseId: row.warehouse_id || '',
    customerName: row.client_name || '',
    customerNif: row.client_nif || '',
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone || '',
    customerAddress: row.customer_address || '',
    clientId: row.client_id || '',
    clientName: row.client_name || '',
    clientNif: row.client_nif || '',
    items: items.map(mapItemRow),
    subtotal: Number(row.subtotal) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    discount: Number(row.discount) || 0,
    total: Number(row.total) || 0,
    currency: row.currency || 'AOA',
    status: row.status || 'draft',
    reservedAt: row.reserved_at ? new Date(row.reserved_at).toISOString() : undefined,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : undefined,
    notes: row.notes || '',
    convertedToInvoiceId: row.converted_to_invoice_id || undefined,
    convertedToInvoiceNumber: row.converted_to_invoice_number || undefined,
    convertedAt: row.converted_at ? new Date(row.converted_at).toISOString() : undefined,
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}

function bodyToHeader(body) {
  const b = body || {};
  return {
    id: String(b.id || newId()),
    order_number: String(b.orderNumber || b.order_number || ''),
    client_id: String(b.clientId || b.client_id || ''),
    client_name: String(b.customerName || b.client_name || b.clientName || ''),
    client_nif: String(b.customerNif || b.client_nif || b.clientNif || ''),
    customer_email: String(b.customerEmail || b.customer_email || ''),
    customer_phone: String(b.customerPhone || b.customer_phone || ''),
    customer_address: String(b.customerAddress || b.customer_address || ''),
    branch_id: String(b.branchId || b.branch_id || ''),
    branch_name: String(b.branchName || b.branch_name || ''),
    warehouse_id: String(b.warehouseId || b.warehouse_id || ''),
    subtotal: Number(b.subtotal) || 0,
    tax_amount: Number(b.taxAmount ?? b.tax_amount ?? 0),
    discount: Number(b.discount) || 0,
    total: Number(b.total) || 0,
    currency: String(b.currency || 'AOA'),
    status: String(b.status || 'draft'),
    reserved_at: b.reservedAt || b.reserved_at || null,
    confirmed_at: b.confirmedAt || b.confirmed_at || null,
    notes: String(b.notes || ''),
    converted_to_invoice_id: String(b.convertedToInvoiceId || b.converted_to_invoice_id || ''),
    converted_to_invoice_number: String(b.convertedToInvoiceNumber || b.converted_to_invoice_number || ''),
    converted_at: b.convertedAt || b.converted_at || null,
    created_by: String(b.createdBy || b.created_by || ''),
    created_by_name: String(b.createdByName || b.created_by_name || ''),
    created_at: b.createdAt || b.created_at || new Date().toISOString(),
    updated_at: b.updatedAt || b.updated_at || new Date().toISOString(),
  };
}

async function loadItemsForOrder(salesOrderId) {
  const result = await db.query(
    'SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_name',
    [salesOrderId],
  );
  return result.rows || [];
}

async function replaceItems(client, salesOrderId, items, branchId) {
  await client.query('DELETE FROM sales_order_items WHERE sales_order_id = $1', [salesOrderId]);
  for (const raw of items || []) {
    const item = raw || {};
    const qty = Number(item.quantity) || 0;
    const reservedQty = Number(item.reservedQty ?? item.reserved_qty ?? 0);
    const shippedQty = Number(item.shippedQty ?? item.shipped_qty ?? 0);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
    const discount = Number(item.discount) || 0;
    const taxRate = Number(item.taxRate ?? item.tax_rate ?? 14);
    const subtotal = Number(item.subtotal) || qty * unitPrice * (1 - discount / 100);
    const taxAmount = Number(item.taxAmount ?? item.tax_amount ?? subtotal * (taxRate / 100));
    const total = Number(item.total) || subtotal + taxAmount;
    await client.query(
      `INSERT INTO sales_order_items (
        id, sales_order_id, product_id, product_name, sku, description,
        quantity, reserved_qty, shipped_qty, unit_price, discount, tax_rate, tax_amount, subtotal, total, branch_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        String(item.id || newId()),
        salesOrderId,
        String(item.productId || item.product_id || ''),
        String(item.productName || item.product_name || item.description || ''),
        String(item.sku || ''),
        String(item.description || item.productName || item.product_name || ''),
        qty,
        reservedQty,
        shippedQty,
        unitPrice,
        discount,
        taxRate,
        taxAmount,
        subtotal,
        total,
        String(branchId || item.branch_id || ''),
      ],
    );
  }
}

function orderAuditLabel(number) {
  const n = String(number || '').trim();
  return n || 'sem número';
}

async function auditSalesOrderEvent(req, { recordId, action, description, newValues, oldValues, metadata }) {
  try {
    await logFiscalEventFromReq(req, {
      tableName: 'sales_orders',
      recordId,
      action,
      description,
      newValues,
      oldValues,
      metadata: { documentKind: 'SO', ...metadata },
    });
  } catch (err) {
    console.warn('[SALES_ORDERS] audit:', err.message);
  }
}

/** Payload suitable for FE to call api.sales.create — no sale is created here. */
function buildInvoicePayload(order) {
  return {
    branchId: order.branchId,
    branchName: order.branchName,
    clientId: order.clientId,
    customerName: order.customerName,
    customerNif: order.customerNif,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    warehouseId: order.warehouseId,
    items: (order.items || []).map((item) => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      subtotal: item.subtotal,
      total: item.total,
    })),
    subtotal: order.subtotal,
    taxAmount: order.taxAmount,
    discount: order.discount,
    total: order.total,
    currency: order.currency || 'AOA',
    paymentMethod: 'credit',
    amountPaid: 0,
    parentSalesOrderId: order.id,
    parentSalesOrderNumber: order.orderNumber,
    notes: order.notes || '',
  };
}

async function loadOrderById(id) {
  const result = await db.query('SELECT * FROM sales_orders WHERE id = $1 LIMIT 1', [id]);
  if (!result.rows.length) return null;
  const items = await loadItemsForOrder(id);
  return mapSalesOrderRow(result.rows[0], items);
}

module.exports = function salesOrdersRoutes(broadcastTable) {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    try {
      const branchId = req.query.branchId ? String(req.query.branchId).trim() : '';
      let query = 'SELECT * FROM sales_orders';
      const params = [];
      if (branchId) {
        query += ' WHERE TRIM(COALESCE(branch_id, \'\')) = $1';
        params.push(branchId);
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      const rows = [];
      for (const row of result.rows || []) {
        const items = await loadItemsForOrder(row.id);
        rows.push(mapSalesOrderRow(row, items));
      }
      res.json(rows);
    } catch (error) {
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch sales orders' });
    }
  });

  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const order = await loadOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      res.json(order);
    } catch (error) {
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch sales order' });
    }
  });

  router.post('/', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const header = bodyToHeader(req.body);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sales_orders (
          id, order_number, client_id, client_name, client_nif,
          customer_email, customer_phone, customer_address,
          branch_id, branch_name, warehouse_id,
          subtotal, tax_amount, discount, total, currency,
          status, reserved_at, confirmed_at, notes,
          converted_to_invoice_id, converted_to_invoice_number, converted_at,
          created_by, created_by_name, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
        )`,
        [
          header.id,
          header.order_number,
          header.client_id,
          header.client_name,
          header.client_nif,
          header.customer_email,
          header.customer_phone,
          header.customer_address,
          header.branch_id,
          header.branch_name,
          header.warehouse_id,
          header.subtotal,
          header.tax_amount,
          header.discount,
          header.total,
          header.currency,
          header.status,
          header.reserved_at || null,
          header.confirmed_at || null,
          header.notes,
          header.converted_to_invoice_id || null,
          header.converted_to_invoice_number || null,
          header.converted_at || null,
          header.created_by,
          header.created_by_name,
          header.created_at,
          header.updated_at,
        ],
      );
      await replaceItems(client, header.id, items, header.branch_id);
      await client.query('COMMIT');
      const saved = await loadOrderById(header.id);
      await auditSalesOrderEvent(req, {
        recordId: header.id,
        action: 'create',
        description: `Encomenda ${orderAuditLabel(saved.orderNumber)} criada`,
        newValues: {
          orderNumber: saved.orderNumber,
          status: saved.status,
          total: saved.total,
          customerName: saved.customerName,
        },
      });
      await broadcastTable('sales_orders');
      res.status(201).json(saved);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to save sales order' });
    } finally {
      client.release();
    }
  });

  router.put('/:id', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const id = req.params.id;
      const existing = await db.query('SELECT status FROM sales_orders WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      if (!ACTIVE_STATUSES.includes(existing.rows[0].status)) {
        return res.status(400).json({ error: 'Cannot edit a converted or cancelled sales order' });
      }
      const header = bodyToHeader({ ...req.body, id });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE sales_orders SET
          order_number = $1,
          client_id = $2,
          client_name = $3,
          client_nif = $4,
          customer_email = $5,
          customer_phone = $6,
          customer_address = $7,
          branch_id = $8,
          branch_name = $9,
          warehouse_id = $10,
          subtotal = $11,
          tax_amount = $12,
          discount = $13,
          total = $14,
          currency = $15,
          status = $16,
          reserved_at = $17,
          confirmed_at = $18,
          notes = $19,
          converted_to_invoice_id = $20,
          converted_to_invoice_number = $21,
          converted_at = $22,
          created_by = $23,
          created_by_name = $24,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $25
        RETURNING *`,
        [
          header.order_number,
          header.client_id,
          header.client_name,
          header.client_nif,
          header.customer_email,
          header.customer_phone,
          header.customer_address,
          header.branch_id,
          header.branch_name,
          header.warehouse_id,
          header.subtotal,
          header.tax_amount,
          header.discount,
          header.total,
          header.currency,
          header.status,
          header.reserved_at || null,
          header.confirmed_at || null,
          header.notes,
          header.converted_to_invoice_id || null,
          header.converted_to_invoice_number || null,
          header.converted_at || null,
          header.created_by,
          header.created_by_name,
          id,
        ],
      );
      await replaceItems(client, id, items, header.branch_id);
      await client.query('COMMIT');
      const saved = mapSalesOrderRow(updated.rows[0], await loadItemsForOrder(id));
      await auditSalesOrderEvent(req, {
        recordId: id,
        action: 'update',
        description: `Encomenda ${orderAuditLabel(saved.orderNumber)} actualizada (${saved.status})`,
        newValues: {
          orderNumber: saved.orderNumber,
          status: saved.status,
          total: saved.total,
        },
      });
      await broadcastTable('sales_orders');
      res.json(saved);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to update sales order' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    try {
      const existing = await db.query(
        'SELECT id, order_number, status FROM sales_orders WHERE id = $1 LIMIT 1',
        [req.params.id],
      );
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      if (existing.rows[0].status === 'converted') {
        return res.status(400).json({ error: 'Cannot cancel a converted sales order' });
      }
      if (existing.rows[0].status === 'cancelled') {
        return res.json({ success: true, status: 'cancelled' });
      }
      await clearReservedQty(db, req.params.id);
      await db.query(
        `UPDATE sales_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id],
      );
      await auditSalesOrderEvent(req, {
        recordId: req.params.id,
        action: 'cancel',
        description: `Encomenda ${orderAuditLabel(existing.rows[0].order_number)} cancelada`,
      });
      await broadcastTable('sales_orders');
      setImmediate(() => {
        try {
          const { enqueueWebhookEvent } = require('../lib/webhooks');
          enqueueWebhookEvent('sales_order.cancelled', {
            id: req.params.id,
            orderNumber: existing.rows[0].order_number,
          }).catch((e) => console.warn('[WEBHOOKS] sales_order.cancelled:', e.message));
        } catch (_) { /* non-fatal */ }
      });
      res.json({ success: true, status: 'cancelled' });
    } catch (error) {
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: 'Failed to cancel sales order' });
    }
  });

  router.post('/:id/confirm', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    try {
      const id = req.params.id;
      const existing = await db.query('SELECT * FROM sales_orders WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      const row = existing.rows[0];
      if (!['draft', 'reserved'].includes(row.status)) {
        return res.status(400).json({ error: `Cannot confirm sales order in status "${row.status}"` });
      }
      // Confirming from reserved releases the soft hold (status leaves 'reserved').
      if (row.status === 'reserved') {
        await clearReservedQty(db, id);
      }
      const updated = await db.query(
        `UPDATE sales_orders
         SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [id],
      );
      const saved = mapSalesOrderRow(updated.rows[0], await loadItemsForOrder(id));
      await auditSalesOrderEvent(req, {
        recordId: id,
        action: 'confirm',
        description: `Encomenda ${orderAuditLabel(saved.orderNumber)} confirmada`,
        newValues: { status: saved.status, confirmedAt: saved.confirmedAt },
      });
      await broadcastTable('sales_orders');
      res.json(saved);
    } catch (error) {
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to confirm sales order' });
    }
  });

  router.post('/:id/reserve', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const id = req.params.id;
      const existing = await client.query('SELECT * FROM sales_orders WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      const row = existing.rows[0];
      if (!['draft', 'confirmed'].includes(row.status)) {
        return res.status(400).json({ error: `Cannot reserve sales order in status "${row.status}"` });
      }
      const items = await loadItemsForOrder(id);
      const hasLines = (items || []).some((it) => String(it.product_id || '').trim() && Number(it.quantity) > 0);
      if (!hasLines) {
        return res.status(400).json({
          error: 'Add product lines before reserving stock',
        });
      }
      try {
        await assertSoftReserveAvailable(row, items);
      } catch (availErr) {
        const status = availErr.statusCode || 400;
        return res.status(status).json({
          error: availErr.message,
          shortfalls: availErr.shortfalls || undefined,
        });
      }
      await client.query('BEGIN');
      await client.query(
        `UPDATE sales_order_items SET reserved_qty = quantity WHERE sales_order_id = $1`,
        [id],
      );
      const updated = await client.query(
        `UPDATE sales_orders
         SET status = 'reserved', reserved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [id],
      );
      await client.query('COMMIT');
      const saved = mapSalesOrderRow(updated.rows[0], await loadItemsForOrder(id));
      await auditSalesOrderEvent(req, {
        recordId: id,
        action: 'reserve',
        description: `Encomenda ${orderAuditLabel(saved.orderNumber)} reservada (soft hold)`,
        newValues: { status: saved.status, reservedAt: saved.reservedAt },
      });
      await broadcastTable('sales_orders');
      setImmediate(() => {
        try {
          const { enqueueWebhookEvent } = require('../lib/webhooks');
          enqueueWebhookEvent('sales_order.reserved', {
            id: saved.id,
            orderNumber: saved.orderNumber,
            branchId: saved.branchId,
            total: saved.total,
          }).catch((e) => console.warn('[WEBHOOKS] sales_order.reserved:', e.message));
        } catch (_) { /* non-fatal */ }
      });
      res.json(saved);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to reserve sales order' });
    } finally {
      client.release();
    }
  });

  router.post('/:id/ship', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const id = req.params.id;
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM sales_orders WHERE id = $1 LIMIT 1 FOR UPDATE', [id]);
      if (!existing.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sales order not found' });
      }
      const row = existing.rows[0];
      if (!['confirmed', 'reserved', 'partially_shipped'].includes(row.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Cannot ship sales order in status "${row.status}"` });
      }
      const items = await loadItemsForOrder(id);
      const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      // Default: ship all remaining qty on each line.
      const shipMap = new Map();
      if (lines.length) {
        for (const line of lines) {
          const itemId = String(line.itemId || line.id || '').trim();
          const qty = Number(line.qty ?? line.quantity);
          if (itemId && Number.isFinite(qty) && qty > 0) shipMap.set(itemId, qty);
        }
      } else {
        for (const it of items) {
          const remaining = Math.max(0, Number(it.quantity) - Number(it.shippedQty || 0));
          if (remaining > 0) shipMap.set(it.id, remaining);
        }
      }
      if (!shipMap.size) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Nothing to ship' });
      }

      for (const it of items) {
        const add = Number(shipMap.get(it.id) || 0);
        if (add <= 0) continue;
        const already = Number(it.shippedQty || 0);
        const maxShip = Math.max(0, Number(it.quantity) - already);
        const shipQty = Math.min(add, maxShip);
        if (shipQty <= 0) continue;
        const newShipped = already + shipQty;
        const newReserved = Math.max(0, Number(it.reservedQty || 0) - shipQty);
        await client.query(
          `UPDATE sales_order_items
           SET shipped_qty = $2, reserved_qty = $3
           WHERE id = $1`,
          [it.id, newShipped, newReserved],
        );
      }

      const refreshed = await loadItemsForOrder(id);
      const allShipped = refreshed.every((it) => Number(it.shippedQty || 0) + 0.0001 >= Number(it.quantity || 0));
      const anyShipped = refreshed.some((it) => Number(it.shippedQty || 0) > 0);
      const nextStatus = allShipped ? 'shipped' : anyShipped ? 'partially_shipped' : row.status;
      await client.query(
        `UPDATE sales_orders SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, nextStatus],
      );
      await client.query('COMMIT');
      const order = mapSalesOrderRow(
        { ...row, status: nextStatus, updated_at: new Date().toISOString() },
        refreshed,
      );
      await auditSalesOrderEvent(req, {
        recordId: id,
        action: 'ship',
        description: `Encomenda ${orderAuditLabel(order.orderNumber)} expedida (${nextStatus})`,
        newValues: { status: nextStatus },
      });
      await broadcastTable('sales_orders');
      res.json(order);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to ship sales order' });
    } finally {
      client.release();
    }
  });

  router.post('/:id/convert', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    try {
      const id = req.params.id;
      const existing = await db.query('SELECT * FROM sales_orders WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      const row = existing.rows[0];
      if (!['confirmed', 'reserved', 'partially_shipped', 'shipped'].includes(row.status)) {
        return res.status(400).json({ error: `Cannot convert sales order in status "${row.status}"` });
      }
      // Do not mark converted / clear soft hold yet — that happens on mark-invoiced
      // after the invoice is actually saved (avoids orphan converted orders).
      const order = mapSalesOrderRow(row, await loadItemsForOrder(id));
      const invoicePayload = buildInvoicePayload(order);
      await auditSalesOrderEvent(req, {
        recordId: id,
        action: 'convert_prepare',
        description: `Encomenda ${orderAuditLabel(order.orderNumber)} preparada para fatura`,
        newValues: { status: order.status },
        metadata: { invoicePayloadReady: true },
      });
      // FE opens /invoices with fromSalesOrder; call mark-invoiced after save.
      res.json({ order, invoicePayload });
    } catch (error) {
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to convert sales order' });
    }
  });

  /** Link a converted order to the invoice created from it. */
  router.post('/:id/mark-invoiced', requireAuth, requirePermission(...MUTATE_PERMS), async (req, res) => {
    try {
      const id = req.params.id;
      const invoiceId = String(req.body?.invoiceId || req.body?.invoice_id || '').trim();
      const invoiceNumber = String(req.body?.invoiceNumber || req.body?.invoice_number || '').trim();
      if (!invoiceId && !invoiceNumber) {
        return res.status(400).json({ error: 'invoiceId or invoiceNumber is required' });
      }
      const existing = await db.query('SELECT * FROM sales_orders WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sales order not found' });
      }
      const updated = await db.query(
        `UPDATE sales_orders
         SET status = 'converted',
             converted_to_invoice_id = COALESCE(NULLIF($2, ''), converted_to_invoice_id),
             converted_to_invoice_number = COALESCE(NULLIF($3, ''), converted_to_invoice_number),
             converted_at = COALESCE(converted_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [id, invoiceId, invoiceNumber],
      );
      await clearReservedQty(db, id);
      const order = mapSalesOrderRow(updated.rows[0], await loadItemsForOrder(id));
      await auditSalesOrderEvent(req, {
        recordId: id,
        action: 'mark_invoiced',
        description: `Encomenda ${orderAuditLabel(order.orderNumber)} ligada à fatura ${invoiceNumber || invoiceId}`,
        newValues: {
          status: order.status,
          convertedToInvoiceId: order.convertedToInvoiceId,
          convertedToInvoiceNumber: order.convertedToInvoiceNumber,
        },
      });
      await broadcastTable('sales_orders');
      res.json(order);
    } catch (error) {
      console.error('[SALES_ORDERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to mark sales order invoiced' });
    }
  });

  return router;
};
