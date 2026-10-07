// Stock Transfers API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { createStockTransfer, processTransferApprove, processTransferReceive } = require('../transactionEngine');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');
const { attachUserBranchScope, resolveListBranchId, applyWriteBranchOverride, isForeignBranch } = require('../middleware/branchScope');

function mapStockTransferError(error) {
  const raw = error?.message || String(error);
  if (/chk_products_stock_nonneg/i.test(raw)) {
    return 'Stock insuficiente na filial de origem. Verifique o inventário e tente novamente.';
  }
  if (/stock insuficiente/i.test(raw)) {
    return raw;
  }
  if (/warehouseId inválido/i.test(raw)) {
    return 'Filial inválida para movimento de stock. Confirme as filiais de origem e destino.';
  }
  if (/conta contabilística não encontrada/i.test(raw)) {
    return 'Plano de contas incompleto (conta 2.2 Mercadorias). Contacte o administrador.';
  }
  return raw || 'Operação de transferência falhou';
}

function stockTransferErrorStatus(message) {
  if (/stock insuficiente|chk_products_stock_nonneg/i.test(message)) return 409;
  return 500;
}

module.exports = function(broadcastTable) {
  const router = express.Router();
  router.use(attachUserBranchScope);

  // READ
  router.get('/', async (req, res) => {
    try {
      const scopedBranchId = resolveListBranchId(req, req.query.branchId);
      if (scopedBranchId === undefined) return res.json([]);
      const openOnly = ['1', 'true', 'yes'].includes(String(req.query.openOnly || '').toLowerCase());
      let query = 'SELECT * FROM stock_transfers';
      const params = [];
      const where = [];
      if (scopedBranchId) {
        where.push('(from_branch_id = $1 OR to_branch_id = $1)');
        params.push(scopedBranchId);
      }
      if (openOnly) {
        where.push(`LOWER(COALESCE(status, '')) IN ('pending', 'in_transit')`);
      }
      if (where.length) query += ` WHERE ${where.join(' AND ')}`;
      query += ' ORDER BY created_at DESC';
      if (openOnly) query += ' LIMIT 300';
      const result = await db.query(query, params);
      const transfers = result.rows || [];
      if (transfers.length > 0) {
        const ids = transfers.map((t) => t.id);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
        const itemsResult = await db.query(
          `SELECT * FROM stock_transfer_items WHERE transfer_id IN (${placeholders}) ORDER BY transfer_id`,
          ids,
        );
        const byTransfer = new Map();
        for (const item of itemsResult.rows || []) {
          const key = String(item.transfer_id);
          if (!byTransfer.has(key)) byTransfer.set(key, []);
          byTransfer.get(key).push(item);
        }
        for (const transfer of transfers) {
          transfer.items = byTransfer.get(String(transfer.id)) || [];
        }
      }
      res.json(transfers);
    } catch (error) {
      console.error('[STOCK TRANSFERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch stock transfers' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  router.post('/', requirePermission('inventory_transfer'), async (req, res) => {
    // Locked users may only ship FROM their own branch. Destination stays as sent
    // so a real transfer between shops still works.
    applyWriteBranchOverride(req, req.body, ['fromBranchId', 'from_branch_id'], 'STOCK TRANSFER');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const transfer = await createStockTransfer(client, req.body);
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
      auditErpSafe(req, {
        table: 'stock_transfers',
        id: transfer?.id,
        action: 'create',
        description: `Transferência de stock criada: ${transfer?.transfer_number || transfer?.id || ''}`,
        newValues: {
          fromBranchId: transfer?.from_branch_id,
          toBranchId: transfer?.to_branch_id,
          status: transfer?.status,
        },
        branchId: transfer?.from_branch_id,
      });
      res.status(201).json(transfer);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[STOCK TRANSFERS ERROR]', error);
      const errorMessage = mapStockTransferError(error);
      res.status(stockTransferErrorStatus(errorMessage)).json({ error: errorMessage });
    } finally {
      client.release();
    }
  });

  // APPROVE: Delegated to Transaction Engine (stock OUT)
  router.post('/:id/approve', requirePermission('inventory_transfer'), async (req, res) => {
    const peek = await db.query('SELECT from_branch_id FROM stock_transfers WHERE id = $1', [req.params.id]);
    if (!peek.rows[0] || isForeignBranch(req.branchScope, peek.rows[0].from_branch_id)) {
      return res.status(404).json({ error: 'Transferência não encontrada' });
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const transfer = await processTransferApprove(client, req.params.id, req.body.approvedBy);
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
      await broadcastTable('products');
      try {
        const { enqueueWebhookEvent } = require('../lib/webhooks');
        enqueueWebhookEvent('stock_transfer.approved', {
          id: req.params.id,
          fromBranchId: transfer.from_branch_id,
          toBranchId: transfer.to_branch_id,
        }).catch((e) => console.warn('[WEBHOOKS] stock_transfer.approved:', e.message));
      } catch (_) { /* non-fatal */ }
      auditErpSafe(req, {
        table: 'stock_transfers',
        id: req.params.id,
        action: 'approve',
        description: `Transferência de stock aprovada: ${req.params.id}`,
        newValues: { fromBranchId: transfer.from_branch_id, toBranchId: transfer.to_branch_id },
        branchId: transfer.from_branch_id,
      });
      res.json({
        success: true,
        from_branch_id: transfer.from_branch_id,
        to_branch_id: transfer.to_branch_id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[STOCK TRANSFERS ERROR]', error);
      const errorMessage = mapStockTransferError(error);
      res.status(stockTransferErrorStatus(errorMessage)).json({ error: errorMessage });
    } finally {
      client.release();
    }
  });

  // RECEIVE: Delegated to Transaction Engine (stock IN + journal)
  router.post('/:id/receive', requirePermission('inventory_transfer'), async (req, res) => {
    const peek = await db.query('SELECT to_branch_id FROM stock_transfers WHERE id = $1', [req.params.id]);
    if (!peek.rows[0] || isForeignBranch(req.branchScope, peek.rows[0].to_branch_id)) {
      return res.status(404).json({ error: 'Transferência não encontrada' });
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const transfer = await processTransferReceive(client, req.params.id, req.body.receivedQuantities, req.body.receivedBy);
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
      await broadcastTable('products');
      try {
        const { enqueueWebhookEvent } = require('../lib/webhooks');
        enqueueWebhookEvent('stock_transfer.received', {
          id: req.params.id,
          fromBranchId: transfer.from_branch_id,
          toBranchId: transfer.to_branch_id,
        }).catch((e) => console.warn('[WEBHOOKS] stock_transfer.received:', e.message));
      } catch (_) { /* non-fatal */ }
      auditErpSafe(req, {
        table: 'stock_transfers',
        id: req.params.id,
        action: 'receive',
        description: `Transferência de stock recebida: ${req.params.id}`,
        newValues: { fromBranchId: transfer.from_branch_id, toBranchId: transfer.to_branch_id },
        branchId: transfer.to_branch_id,
      });
      res.json({
        success: true,
        to_branch_id: transfer.to_branch_id,
        from_branch_id: transfer.from_branch_id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[STOCK TRANSFERS ERROR]', error);
      const errorMessage = mapStockTransferError(error);
      res.status(stockTransferErrorStatus(errorMessage)).json({ error: errorMessage });
    } finally {
      client.release();
    }
  });

  // CANCEL: pending transfers only
  router.post('/:id/cancel', requirePermission('inventory_transfer'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT id, status, from_branch_id, to_branch_id FROM stock_transfers WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Transferência não encontrada');
      if (
        isForeignBranch(req.branchScope, row.from_branch_id)
        && isForeignBranch(req.branchScope, row.to_branch_id)
      ) {
        throw new Error('Transferência não encontrada');
      }
      if (String(row.status || '').toLowerCase() !== 'pending') {
        throw new Error('Só transferências pendentes podem ser canceladas');
      }
      await client.query(
        `UPDATE stock_transfers SET status = 'cancelled' WHERE id = $1`,
        [req.params.id],
      );
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
      auditErpSafe(req, {
        table: 'stock_transfers',
        id: req.params.id,
        action: 'void',
        description: `Transferência de stock cancelada: ${req.params.id}`,
        newValues: { status: 'cancelled' },
      });
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[STOCK TRANSFERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to cancel transfer' });
    } finally {
      client.release();
    }
  });

  return router;
};
