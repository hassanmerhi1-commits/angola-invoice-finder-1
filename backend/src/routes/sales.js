// Sales API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { processSale } = require('../transactionEngine');
const { peekSequenceNumber } = require('../accounting');
const { enqueueSaleCreated } = require('../sync/outbox');
const { signSaleInvoice } = require('../agt/signSale');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // READ
  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM sales';
      const params = [];
      if (branchId) { query += ' WHERE branch_id = $1'; params.push(branchId); }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);

      for (let sale of result.rows) {
        const itemsResult = await db.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
        sale.items = itemsResult.rows;
      }
      res.json(result.rows);
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  // POS cashiers (pos_access) and back-office invoicing (invoice_create) may create sales.
  router.post('/', requirePermission('pos_access', 'invoice_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const sale = await processSale(client, req.body);
      const idemKey = req.body.clientRequestId || req.body.idempotencyKey || `sale:${sale.id}`;
      if (req.body.clientRequestId || req.body.idempotencyKey) {
        await client.query(
          `UPDATE sales SET client_request_id = $1 WHERE id = $2`,
          [idemKey, sale.id]
        );
      }
      await enqueueSaleCreated(client, sale.id, req.body.branchId, idemKey);
      await client.query('COMMIT');
      // Sign the invoice and surface the fiscal hash on the response so the POS
      // receipt prints the genuine AGT signature (not a placeholder). Signing runs
      // after COMMIT; failures must not fail the sale, so they are swallowed here.
      let saftHash = null;
      try {
        await signSaleInvoice(sale.id);
        const signed = await db.query('SELECT saft_hash FROM sales WHERE id = $1', [sale.id]);
        saftHash = signed.rows[0]?.saft_hash || null;
      } catch (e) {
        console.warn('[AGT SIGN]', e.message);
      }
      await broadcastTable('sales');
      await broadcastTable('products');
      res.status(201).json({ ...sale, items: req.body.items, saft_hash: saftHash });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SALES ERROR]', error);
      const raw = error.message || 'Failed to create sale';
      const errorMessage = /chk_products_stock_nonneg/i.test(raw)
        ? 'Stock insuficiente para concluir a venda. Verifique o inventário nesta filial.'
        : /sales_payment_method_check|payment_method_check/i.test(raw)
          ? 'O servidor precisa de atualização: método de pagamento não permitido na base de dados. Reinicie o serviço NEXOR no servidor ou contacte o administrador.'
        : raw;
      const status = /stock insuficiente/i.test(errorMessage)
        ? 409
        : /método de pagamento/i.test(errorMessage)
          ? 503
          : 500;
      res.status(status).json({ error: errorMessage });
    } finally {
      client.release();
    }
  });

  router.post('/:id/mark-printed', requireAuth, async (req, res) => {
    try {
      const { format, reprint, source, documentNumber } = req.body || {};
      const result = await db.query(
        `UPDATE sales SET printed_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING id, invoice_number, printed_at`,
        [req.params.id],
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Sale not found' });
      }
      const row = result.rows[0];
      const formatLabel = format === 'thermal' ? 'térmica' : format === 'a4' ? 'A4' : 'documento';
      const reprintSuffix = reprint ? ' (reimpressão)' : '';
      await logFiscalEventFromReq(req, {
        tableName: 'sales',
        recordId: row.id,
        action: 'print',
        description: `Fatura ${row.invoice_number} impressa (${formatLabel})${reprintSuffix}`,
        metadata: {
          format: format || null,
          reprint: !!reprint,
          source: source || null,
          documentNumber: documentNumber || row.invoice_number,
        },
        newValues: {
          printedAt: row.printed_at,
          format: format || null,
          reprint: !!reprint,
          source: source || null,
        },
      });
      await broadcastTable('sales');
      res.json(row);
    } catch (error) {
      console.error('[SALES mark-printed]', error);
      res.status(500).json({ error: error.message || 'Failed to mark printed' });
    }
  });

  // Issued fiscal invoices are immutable — only due date may be adjusted.
  router.patch('/:id', requirePermission('invoice_create'), async (req, res) => {
    try {
      const { dueDate } = req.body;
      const extraKeys = Object.keys(req.body || {}).filter((k) => k !== 'dueDate');
      if (extraKeys.length > 0) {
        return res.status(403).json({
          error: 'Issued invoices cannot be edited. Use a credit note or debit note to correct.',
        });
      }
      if (!dueDate) {
        return res.status(400).json({ error: 'dueDate is required' });
      }
      const existing = await db.query(
        'SELECT id, fiscal_status FROM sales WHERE id = $1',
        [req.params.id],
      );
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Sale not found' });
      }
      if (String(existing.rows[0].fiscal_status || 'issued') === 'cancelled') {
        return res.status(403).json({ error: 'Cancelled invoices cannot be modified' });
      }
      const due = String(dueDate).slice(0, 10);
      const result = await db.query(
        `UPDATE sales SET due_date = $1 WHERE id = $2 RETURNING *`,
        [due, req.params.id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Sale not found' });
      }
      await db.query(
        `UPDATE open_items SET due_date = $1
         WHERE document_id = $2 AND document_type = 'invoice' AND status != 'cleared'`,
        [due, req.params.id],
      );
      await broadcastTable('sales');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to update sale' });
    }
  });

  // Preview next invoice number (actual number assigned atomically in processSale)
  router.get('/generate-invoice-number/:branchCode', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const {
        resolveSaleInvoiceType,
        normalizeCustomerNif,
        sequenceKeyForInvoiceType,
        prefixForInvoiceType,
      } = require('../lib/fiscalInvoiceType');
      const { peekSequenceNumber, normalizeBranchCode, bumpSequenceFromExistingSales } = require('../accounting');

      const branchCode = normalizeBranchCode(req.params.branchCode);
      const branchRow = await client.query(
        'SELECT id FROM branches WHERE UPPER(REPLACE(code, \' \', \'\')) = $1 OR id::text = $1 LIMIT 1',
        [branchCode],
      );
      const branchId = branchRow.rows[0]?.id;
      const invoiceType = resolveSaleInvoiceType({
        customerNif: normalizeCustomerNif(req.query.customerNif),
        paymentMethod: req.query.paymentMethod || 'cash',
        total: Number(req.query.total) || 0,
      });
      const seqKey = sequenceKeyForInvoiceType(invoiceType);
      const prefix = prefixForInvoiceType(invoiceType);
      const scope = branchId ? { branchId, branchCode } : { branchCode };
      if (branchId) {
        await bumpSequenceFromExistingSales(client, seqKey, prefix, scope);
      }
      const invoiceNumber = await peekSequenceNumber(client, seqKey, prefix, scope);
      res.json({ invoiceNumber, invoiceType });
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: 'Failed to generate invoice number' });
    } finally {
      client.release();
    }
  });

  return router;
};
