// Import orders API — landed cost workflow + stock IN on receive
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { generateSequenceNumber } = require('../accounting');
const { recordStockMovement, auditLog } = require('../transactionEngine');

const VALID_STATUSES = new Set([
  'draft', 'ordered', 'shipped', 'in_customs', 'cleared', 'received', 'cancelled',
]);

const STATUS_FLOW = {
  draft: ['ordered', 'cancelled'],
  ordered: ['shipped', 'cancelled'],
  shipped: ['in_customs', 'cancelled'],
  in_customs: ['cleared', 'cancelled'],
  cleared: ['received', 'cancelled'],
};

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function fromRow(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierCountry: row.supplier_country,
    transportMode: row.transport_mode,
    incoterm: row.incoterm,
    portOfOrigin: row.port_of_origin,
    portOfDestination: row.port_of_destination,
    currency: row.currency,
    exchangeRate: Number(row.exchange_rate || 1),
    fobValue: Number(row.fob_value || 0),
    fobValueAOA: Number(row.fob_value_aoa || 0),
    freightCost: Number(row.freight_cost || 0),
    insuranceCost: Number(row.insurance_cost || 0),
    cifValue: Number(row.cif_value || 0),
    customsDeclarationNumber: row.customs_declaration_number,
    customsDutyRate: Number(row.customs_duty_rate || 0),
    customsDutyAmount: Number(row.customs_duty_amount || 0),
    otherTaxes: Number(row.other_taxes || 0),
    totalCustoms: Number(row.total_customs || 0),
    portCharges: Number(row.port_charges || 0),
    transportLocal: Number(row.transport_local || 0),
    otherCosts: Number(row.other_costs || 0),
    totalLandedCost: Number(row.total_landed_cost || 0),
    costPerUnit: Number(row.cost_per_unit || 0),
    totalQuantity: Number(row.total_quantity || 0),
    status: row.status,
    orderDate: row.order_date,
    shippingDate: row.shipping_date,
    arrivalDate: row.arrival_date,
    customsClearanceDate: row.customs_clearance_date,
    receivedDate: row.received_date,
    branchId: row.branch_id,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(fromItemRow),
  };
}

function fromItemRow(row) {
  return {
    id: row.id,
    importOrderId: row.import_order_id,
    productId: row.product_id,
    description: row.description,
    hsCode: row.hs_code,
    quantity: Number(row.quantity || 0),
    unit: row.unit || 'un',
    unitPriceForeign: Number(row.unit_price_foreign || 0),
    unitPriceAOA: Number(row.unit_price_aoa || 0),
    totalForeign: Number(row.total_foreign || 0),
    totalAOA: Number(row.total_aoa || 0),
    landedCostPerUnit: Number(row.landed_cost_per_unit || 0),
    receivedQuantity: Number(row.received_quantity || 0),
  };
}

function computeLandedTotals(body) {
  const exchangeRate = Number(body.exchangeRate ?? body.exchange_rate ?? 1) || 1;
  const fobValue = Number(body.fobValue ?? body.fob_value ?? 0) || 0;
  const freightCost = Number(body.freightCost ?? body.freight_cost ?? 0) || 0;
  const insuranceCost = Number(body.insuranceCost ?? body.insurance_cost ?? 0) || 0;
  const customsDutyRate = Number(body.customsDutyRate ?? body.customs_duty_rate ?? 0) || 0;
  const portCharges = Number(body.portCharges ?? body.port_charges ?? 0) || 0;
  const transportLocal = Number(body.transportLocal ?? body.transport_local ?? 0) || 0;
  const otherCosts = Number(body.otherCosts ?? body.other_costs ?? 0) || 0;

  const fobValueAOA = roundMoney(fobValue * exchangeRate);
  const cifValue = roundMoney(fobValue + freightCost + insuranceCost);
  const cifAOA = roundMoney(cifValue * exchangeRate);
  const customsDutyAmount = roundMoney(cifAOA * (customsDutyRate / 100));
  const totalCustoms = roundMoney(customsDutyAmount + Number(body.otherTaxes ?? body.other_taxes ?? 0));
  const totalLandedCost = roundMoney(cifAOA + totalCustoms + portCharges + transportLocal + otherCosts);

  return {
    exchangeRate,
    fobValue,
    fobValueAOA,
    freightCost,
    insuranceCost,
    cifValue,
    customsDutyRate,
    customsDutyAmount,
    totalCustoms,
    portCharges,
    transportLocal,
    otherCosts,
    totalLandedCost,
  };
}

async function loadItemsForOrders(orderIds) {
  if (!orderIds.length) return new Map();
  const ph = orderIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await db.query(
    `SELECT * FROM import_order_items WHERE import_order_id IN (${ph}) ORDER BY created_at ASC`,
    orderIds,
  );
  const map = new Map();
  for (const row of result.rows || []) {
    const key = String(row.import_order_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function loadOrderById(id) {
  const result = await db.query('SELECT * FROM import_orders WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  const items = await db.query(
    'SELECT * FROM import_order_items WHERE import_order_id = $1 ORDER BY created_at ASC',
    [id],
  );
  return fromRow(result.rows[0], items.rows || []);
}

module.exports = function importOrdersRoutes(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { branchId, status } = req.query;
      let query = 'SELECT * FROM import_orders WHERE 1=1';
      const params = [];
      let idx = 1;
      if (branchId) {
        query += ` AND branch_id = $${idx++}`;
        params.push(branchId);
      }
      if (status) {
        query += ` AND status = $${idx++}`;
        params.push(status);
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      const ids = (result.rows || []).map((r) => r.id);
      const itemsMap = await loadItemsForOrders(ids);
      res.json((result.rows || []).map((row) => fromRow(row, itemsMap.get(String(row.id)) || [])));
    } catch (error) {
      console.error('[IMPORT ORDERS]', error);
      res.status(500).json({ error: 'Failed to list import orders' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const order = await loadOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Not found' });
      res.json(order);
    } catch (error) {
      console.error('[IMPORT ORDERS]', error);
      res.status(500).json({ error: 'Failed to fetch import order' });
    }
  });

  router.post('/', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const body = req.body || {};
      const supplierName = String(body.supplierName ?? body.supplier_name ?? '').trim();
      if (!supplierName) {
        return res.status(400).json({ error: 'supplierName is required' });
      }

      await client.query('BEGIN');
      const orderNumber = await generateSequenceNumber(client, 'import_order', 'IMP');
      const totals = computeLandedTotals(body);
      const items = Array.isArray(body.items) ? body.items : [];
      const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      const costPerUnit = totalQty > 0 ? roundMoney(totals.totalLandedCost / totalQty) : 0;
      const orderId = body.id || crypto.randomUUID();
      const today = new Date().toISOString().split('T')[0];

      await client.query(
        `INSERT INTO import_orders (
          id, order_number, supplier_id, supplier_name, supplier_country,
          transport_mode, incoterm, port_of_origin, port_of_destination,
          currency, exchange_rate, fob_value, fob_value_aoa, freight_cost, insurance_cost, cif_value,
          customs_declaration_number, customs_duty_rate, customs_duty_amount, other_taxes, total_customs,
          port_charges, transport_local, other_costs, total_landed_cost, cost_per_unit, total_quantity,
          status, order_date, branch_id, notes, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
          $28,$29,$30,$31,$32
        )`,
        [
          orderId,
          orderNumber,
          body.supplierId || body.supplier_id || null,
          supplierName,
          body.supplierCountry || body.supplier_country || '',
          body.transportMode || body.transport_mode || 'sea',
          body.incoterm || 'FOB',
          body.portOfOrigin || body.port_of_origin || '',
          body.portOfDestination || body.port_of_destination || 'Luanda',
          body.currency || 'USD',
          totals.exchangeRate,
          totals.fobValue,
          totals.fobValueAOA,
          totals.freightCost,
          totals.insuranceCost,
          totals.cifValue,
          body.customsDeclarationNumber || body.customs_declaration_number || null,
          totals.customsDutyRate,
          totals.customsDutyAmount,
          Number(body.otherTaxes ?? body.other_taxes ?? 0),
          totals.totalCustoms,
          totals.portCharges,
          totals.transportLocal,
          totals.otherCosts,
          totals.totalLandedCost,
          costPerUnit,
          totalQty,
          body.status || 'draft',
          body.orderDate || body.order_date || today,
          body.branchId || body.branch_id || null,
          body.notes || '',
          body.createdBy || body.created_by || null,
        ],
      );

      for (const item of items) {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;
        const unitForeign = Number(item.unitPriceForeign ?? item.unit_price_foreign ?? 0);
        const unitAOA = Number(item.unitPriceAOA ?? item.unit_price_aoa ?? unitForeign * totals.exchangeRate);
        const landed = Number(item.landedCostPerUnit ?? item.landed_cost_per_unit ?? costPerUnit);
        await client.query(
          `INSERT INTO import_order_items (
            id, import_order_id, product_id, description, hs_code, quantity, unit,
            unit_price_foreign, unit_price_aoa, total_foreign, total_aoa, landed_cost_per_unit
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            item.id || crypto.randomUUID(),
            orderId,
            item.productId || item.product_id || null,
            item.description || '',
            item.hsCode || item.hs_code || null,
            qty,
            item.unit || 'un',
            unitForeign,
            unitAOA,
            roundMoney(unitForeign * qty),
            roundMoney(unitAOA * qty),
            landed,
          ],
        );
      }

      await client.query('COMMIT');
      await broadcastTable?.('import_orders');
      const saved = await loadOrderById(orderId);
      res.status(201).json(saved);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[IMPORT ORDERS]', error);
      res.status(500).json({ error: error.message || 'Failed to create import order' });
    } finally {
      client.release();
    }
  });

  router.post('/:id/status', async (req, res) => {
    try {
      const nextStatus = String(req.body?.status || '').trim().toLowerCase();
      if (!VALID_STATUSES.has(nextStatus)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const current = await db.query('SELECT id, status FROM import_orders WHERE id = $1', [req.params.id]);
      const row = current.rows[0];
      if (!row) return res.status(404).json({ error: 'Not found' });

      const prev = String(row.status || 'draft').toLowerCase();
      if (prev === nextStatus) {
        const order = await loadOrderById(req.params.id);
        return res.json(order);
      }
      if (prev === 'received' || prev === 'cancelled') {
        return res.status(409).json({ error: `Cannot change status from ${prev}` });
      }
      const allowed = STATUS_FLOW[prev] || [];
      if (!allowed.includes(nextStatus) && nextStatus !== 'cancelled') {
        return res.status(409).json({ error: `Invalid transition ${prev} → ${nextStatus}` });
      }

      const today = new Date().toISOString().split('T')[0];
      const dateSets = [];
      const params = [nextStatus];
      let idx = 2;
      if (nextStatus === 'shipped') { dateSets.push(`shipping_date = $${idx++}`); params.push(today); }
      if (nextStatus === 'in_customs') { dateSets.push(`arrival_date = $${idx++}`); params.push(today); }
      if (nextStatus === 'cleared') { dateSets.push(`customs_clearance_date = $${idx++}`); params.push(today); }
      if (nextStatus === 'received') { dateSets.push(`received_date = $${idx++}`); params.push(today); }
      params.push(req.params.id);

      await db.query(
        `UPDATE import_orders SET status = $1, updated_at = CURRENT_TIMESTAMP${dateSets.length ? `, ${dateSets.join(', ')}` : ''} WHERE id = $${idx}`,
        params,
      );
      await broadcastTable?.('import_orders');
      const order = await loadOrderById(req.params.id);
      res.json(order);
    } catch (error) {
      console.error('[IMPORT ORDERS]', error);
      res.status(500).json({ error: error.message || 'Failed to update status' });
    }
  });

  router.post('/:id/receive', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const receivedBy = req.body?.receivedBy || req.body?.received_by;
      const warehouseId = req.body?.warehouseId || req.body?.warehouse_id || req.body?.branchId || req.body?.branch_id;

      await client.query('BEGIN');
      const orderRes = await client.query('SELECT * FROM import_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
      const order = orderRes.rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }
      const status = String(order.status || '').toLowerCase();
      if (status === 'received') {
        await client.query('ROLLBACK');
        const existing = await loadOrderById(req.params.id);
        return res.json(existing);
      }
      if (status !== 'cleared' && status !== 'in_customs') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Import must be cleared before receive (current: ${status})` });
      }

      const branchId = warehouseId || order.branch_id;
      if (!branchId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'branchId / warehouseId is required' });
      }

      const itemsRes = await client.query(
        'SELECT * FROM import_order_items WHERE import_order_id = $1',
        [req.params.id],
      );
      const stockItems = (itemsRes.rows || []).filter(
        (it) => it.product_id && Number(it.quantity || 0) > 0,
      );

      const movementIds = [];
      for (const item of stockItems) {
        const qty = Number(item.quantity || 0);
        const unitCost = Number(item.landed_cost_per_unit || order.cost_per_unit || 0);
        const movement = await recordStockMovement(client, {
          productId: item.product_id,
          warehouseId: branchId,
          movementType: 'IN',
          quantity: qty,
          unitCost,
          referenceType: 'import_order',
          referenceId: order.id,
          referenceNumber: order.order_number,
          notes: `Import ${order.order_number}`,
          createdBy: receivedBy,
        });
        movementIds.push(movement.id);
        await client.query(
          'UPDATE import_order_items SET received_quantity = $1 WHERE id = $2',
          [qty, item.id],
        );
      }

      const today = new Date().toISOString().split('T')[0];
      await client.query(
        `UPDATE import_orders SET status = 'received', received_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [today, req.params.id],
      );

      await auditLog(client, {
        tableName: 'import_orders',
        recordId: order.id,
        action: 'status_change',
        userId: receivedBy,
        branchId,
        newValues: { status: 'received', stockMovementIds: movementIds },
        description: `Import ${order.order_number} received`,
      });

      await client.query('COMMIT');
      await broadcastTable?.('import_orders');
      if (movementIds.length) await broadcastTable?.('products');

      const saved = await loadOrderById(req.params.id);
      res.json({ ...saved, stockMovementIds: movementIds });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[IMPORT ORDERS]', error);
      res.status(500).json({ error: error.message || 'Failed to receive import order' });
    } finally {
      client.release();
    }
  });

  return router;
};
