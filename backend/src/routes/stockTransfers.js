// Stock Transfers API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { createStockTransfer, processTransferApprove, processTransferReceive } = require('../transactionEngine');

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

  // READ
  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM stock_transfers';
      const params = [];
      if (branchId) { query += ' WHERE from_branch_id = $1 OR to_branch_id = $1'; params.push(branchId); }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);

      for (let transfer of result.rows) {
        const itemsResult = await db.query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1', [transfer.id]);
        transfer.items = itemsResult.rows;
      }
      res.json(result.rows);
    } catch (error) {
      console.error('[STOCK TRANSFERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch stock transfers' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  router.post('/', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const transfer = await createStockTransfer(client, req.body);
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
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
  router.post('/:id/approve', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const transfer = await processTransferApprove(client, req.params.id, req.body.approvedBy);
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
      await broadcastTable('products');
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
  router.post('/:id/receive', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const transfer = await processTransferReceive(client, req.params.id, req.body.receivedQuantities, req.body.receivedBy);
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
      await broadcastTable('products');
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
  router.post('/:id/cancel', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT id, status FROM stock_transfers WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Transferência não encontrada');
      if (String(row.status || '').toLowerCase() !== 'pending') {
        throw new Error('Só transferências pendentes podem ser canceladas');
      }
      await client.query(
        `UPDATE stock_transfers SET status = 'cancelled' WHERE id = $1`,
        [req.params.id],
      );
      await client.query('COMMIT');
      await broadcastTable('stock_transfers');
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
