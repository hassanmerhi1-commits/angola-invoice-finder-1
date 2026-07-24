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

function isPaymentMethodConstraintError(err) {
  const msg = String(err?.message || err || '');
  return /sales_payment_method_check|payment_method_check|violates check constraint.*payment_method/i.test(msg);
}

async function repairCreditPaymentSchema() {
  const { ensureSalesCreditPaymentMethod } = require('../lib/ensurePhaseSchema');
  const { salesAllowsCreditPayment } = require('../lib/schemaChecks');
  await ensureSalesCreditPaymentMethod(db);
  return salesAllowsCreditPayment(db);
}

async function commitSaleCreation(client, sale, body) {
  const idemKey = body.clientRequestId || body.idempotencyKey || `sale:${sale.id}`;
  if (body.clientRequestId || body.idempotencyKey) {
    await client.query(
      `UPDATE sales SET client_request_id = $1 WHERE id = $2`,
      [idemKey, sale.id],
    );
  }
  // Outbox must not abort a completed sale transaction.
  const { runOptionalInSavepoint } = require('../lib/pgSavepoint');
  await runOptionalInSavepoint(client, 'sale_outbox', async () => {
    await enqueueSaleCreated(client, sale.id, body.branchId, idemKey);
  }, (e) => {
    console.warn('[SALES] outbox enqueue skipped:', e.message);
  });
  await client.query('COMMIT');
  return sale;
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  // READ — default capped list; items loaded in one IN() query (no N+1).
  router.get('/', async (req, res) => {
    try {
      const { parseListPagination } = require('../lib/listPagination');
      const { branchId } = req.query;
      const { limit, offset } = parseListPagination(req, { defaultLimit: 200, maxLimit: 2000 });
      let query = 'SELECT * FROM sales';
      const params = [];
      if (branchId) {
        query += ' WHERE branch_id = $1';
        params.push(branchId);
      }
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const result = await db.query(query, params);
      const sales = result.rows || [];
      if (sales.length > 0) {
        const ids = sales.map((s) => s.id);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
        const itemsResult = await db.query(
          `SELECT * FROM sale_items WHERE sale_id IN (${placeholders}) ORDER BY sale_id`,
          ids,
        );
        const bySale = new Map();
        for (const item of itemsResult.rows || []) {
          const key = String(item.sale_id);
          if (!bySale.has(key)) bySale.set(key, []);
          bySale.get(key).push(item);
        }
        for (const sale of sales) {
          sale.items = bySale.get(String(sale.id)) || [];
        }
      }
      res.json(sales);
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  // POS cashiers (pos_access) and back-office invoicing (invoice_create) may create sales.
  router.post('/', requirePermission('pos_access', 'invoice_create'), async (req, res) => {
    let client = await db.pool.connect();
    const { trackFirstSqlError } = require('../lib/trackFirstSqlError');
    trackFirstSqlError(client);
    let attempt = 0;
    const isCredit = String(req.body?.paymentMethod || req.body?.payment_method || '').toLowerCase() === 'credit';
    if (isCredit && db.engine === 'postgres') {
      const { ensureSalesCreditPaymentMethod, ensureSalesClientIdColumn } = require('../lib/ensurePhaseSchema');
      await ensureSalesCreditPaymentMethod(db);
      await ensureSalesClientIdColumn(db);
    }
    try {
      for (;;) {
        try {
          await client.query('BEGIN');
          const sale = await processSale(client, req.body);
          const pm = String(req.body?.paymentMethod || req.body?.payment_method || '').toLowerCase();
          console.log(
            `[SALES CREATE] ${sale.invoice_number || sale.invoiceNumber || '?'} `
            + `payment=${pm || 'cash'} type=${sale.invoice_type || sale.invoiceType || '?'} `
            + `client=${String(req.body?.clientId || req.body?.client_id || '').slice(0, 8) || 'none'} `
            + `paid=${req.body?.amountPaid ?? req.body?.amount_paid ?? '?'}`,
          );
          await commitSaleCreation(client, sale, req.body);
          // Fiscal signing reads PKCS#12 from disk — defer so POS checkout is not blocked.
          setImmediate(() => {
            signSaleInvoice(sale.id)
              .then(() => broadcastTable('sales'))
              .catch((e) => console.warn('[AGT SIGN]', e.message));
          });
          setImmediate(() => {
            const { enqueueWebhookEvent } = require('../lib/webhooks');
            enqueueWebhookEvent('sale.created', {
              id: sale.id,
              invoiceNumber: sale.invoice_number || sale.invoiceNumber,
              total: sale.total,
              branchId: sale.branch_id || sale.branchId || req.body.branchId,
              paymentMethod: sale.payment_method || sale.paymentMethod || req.body.paymentMethod,
            }).catch((e) => console.warn('[WEBHOOKS] sale.created:', e.message));
          });
          await broadcastTable('sales');
          await broadcastTable('products');
          if (isCredit) {
            await broadcastTable('open_items');
            await broadcastTable('clients');
            await broadcastTable('journal_entries');
          }
          return res.status(201).json({
            ...sale,
            items: req.body.items,
            saft_hash: null,
            duplicate: !!sale.duplicate,
          });
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
          if (attempt === 0 && isCredit && isPaymentMethodConstraintError(error)) {
            console.warn('[SALES] credit constraint hit — auto-repairing schema and retrying once');
            const repaired = await repairCreditPaymentSchema();
            if (!repaired) throw error;
            attempt += 1;
            // Fresh client after schema repair — previous may be poisoned.
            try { client.release(); } catch (_) { /* ignore */ }
            client = await db.pool.connect();
            trackFirstSqlError(client);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      const first = typeof client.getFirstSqlError === 'function' ? client.getFirstSqlError() : null;
      console.error('[SALES ERROR]', error);
      if (first && first !== error) console.error('[SALES FIRST SQL]', first.message);
      const raw = (first && /current transaction is aborted/i.test(String(error.message || ''))
        ? first.message
        : error.message) || 'Failed to create sale';
      const errorMessage = /chk_products_stock_nonneg/i.test(raw)
        ? 'Stock insuficiente para concluir a venda. Verifique o inventário nesta filial.'
        : isPaymentMethodConstraintError(error) || isPaymentMethodConstraintError(first)
          ? 'Não foi possível registar venda a prazo: a base de dados do servidor ainda não permite pagamento "credit". Reinicie o contentor backend ou execute: docker compose exec backend node scripts/ensure-server-schema.js'
        : /column .*client_id.*does not exist/i.test(raw)
          ? 'Esquema desatualizado: falta sales.client_id. Atualize o backend do servidor (sync-nexor-backend) e reinicie o NEXOR.'
        : raw;
      const status = /stock insuficiente/i.test(errorMessage)
        ? 409
        : isPaymentMethodConstraintError(error) || isPaymentMethodConstraintError(first)
          ? 503
          : 500;
      res.status(status).json({ error: errorMessage });
    } finally {
      client.release();
    }
  });

  // Support / diagnostics — lookup one sale by invoice number (includes open item + journal hints)
  router.get('/by-number/:invoiceNumber', async (req, res) => {
    try {
      const num = decodeURIComponent(String(req.params.invoiceNumber || '').trim());
      if (!num) return res.status(400).json({ error: 'invoiceNumber required' });
      const saleRes = await db.query(
        'SELECT * FROM sales WHERE invoice_number = $1 LIMIT 1',
        [num],
      );
      const sale = saleRes.rows[0];
      if (!sale) return res.status(404).json({ error: 'Sale not found' });

      const [oiRes, jeRes] = await Promise.all([
        db.query(
          `SELECT id, entity_type, entity_id, remaining_amount, status, is_debit
           FROM open_items WHERE document_id = $1 LIMIT 5`,
          [sale.id],
        ),
        db.query(
          `SELECT je.id, je.description, je.created_at
           FROM journal_entries je
           WHERE je.reference_type = 'sale' AND je.reference_id = $1
           ORDER BY je.created_at LIMIT 5`,
          [sale.id],
        ),
      ]);

      res.json({
        sale,
        openItems: oiRes.rows || [],
        journalEntries: jeRes.rows || [],
        diagnosis: {
          isOnAccount: String(sale.payment_method || '').toLowerCase() === 'credit',
          isFinalConsumerFs: String(sale.invoice_type || '').toUpperCase() === 'FS',
          hasReceivableOpenItem: (oiRes.rows || []).some(
            (r) => r.entity_type === 'customer' && r.is_debit && r.status !== 'cleared',
          ),
        },
      });
    } catch (error) {
      console.error('[SALES by-number]', error);
      res.status(500).json({ error: 'Failed to lookup sale' });
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
