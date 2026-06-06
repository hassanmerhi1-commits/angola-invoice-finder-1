// Pro Forma (quotation) API routes
const express = require('express');
const crypto = require('crypto');
const db = require('../db');

function newId() {
  return crypto.randomUUID();
}

function mapItemRow(row) {
  return {
    id: row.id,
    productId: row.product_id || '',
    productName: row.product_name || '',
    sku: row.sku || '',
    description: row.description || '',
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    discount: Number(row.discount) || 0,
    taxRate: Number(row.tax_rate) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    subtotal: Number(row.subtotal) || 0,
    total: Number(row.total) || 0,
  };
}

function mapProformaRow(row, items = []) {
  return {
    id: row.id,
    documentNumber: row.proforma_number || '',
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
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
    validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : '',
    notes: row.notes || '',
    termsAndConditions: row.terms_and_conditions || '',
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
    proforma_number: String(b.documentNumber || b.proforma_number || ''),
    client_id: String(b.clientId || b.client_id || ''),
    client_name: String(b.customerName || b.client_name || b.clientName || ''),
    client_nif: String(b.customerNif || b.client_nif || b.clientNif || ''),
    customer_email: String(b.customerEmail || b.customer_email || ''),
    customer_phone: String(b.customerPhone || b.customer_phone || ''),
    customer_address: String(b.customerAddress || b.customer_address || ''),
    branch_id: String(b.branchId || b.branch_id || ''),
    branch_name: String(b.branchName || b.branch_name || ''),
    subtotal: Number(b.subtotal) || 0,
    tax_amount: Number(b.taxAmount ?? b.tax_amount ?? 0),
    discount: Number(b.discount) || 0,
    total: Number(b.total) || 0,
    currency: String(b.currency || 'AOA'),
    status: String(b.status || 'draft'),
    valid_until: b.validUntil || b.valid_until || null,
    notes: String(b.notes || ''),
    terms_and_conditions: String(b.termsAndConditions || b.terms_and_conditions || ''),
    converted_to_invoice_id: String(b.convertedToInvoiceId || b.converted_to_invoice_id || ''),
    converted_to_invoice_number: String(b.convertedToInvoiceNumber || b.converted_to_invoice_number || ''),
    converted_at: b.convertedAt || b.converted_at || null,
    created_by: String(b.createdBy || b.created_by || ''),
    created_by_name: String(b.createdByName || b.created_by_name || ''),
    created_at: b.createdAt || b.created_at || new Date().toISOString(),
    updated_at: b.updatedAt || b.updated_at || new Date().toISOString(),
  };
}

async function loadItemsForProforma(proformaId) {
  const result = await db.query(
    'SELECT * FROM proforma_items WHERE proforma_id = $1 ORDER BY product_name',
    [proformaId],
  );
  return result.rows || [];
}

async function replaceItems(client, proformaId, items, branchId) {
  await client.query('DELETE FROM proforma_items WHERE proforma_id = $1', [proformaId]);
  for (const raw of items || []) {
    const item = raw || {};
    const qty = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
    const discount = Number(item.discount) || 0;
    const taxRate = Number(item.taxRate ?? item.tax_rate ?? 14);
    const subtotal = Number(item.subtotal) || qty * unitPrice * (1 - discount / 100);
    const taxAmount = Number(item.taxAmount ?? item.tax_amount ?? subtotal * (taxRate / 100));
    const total = Number(item.total) || subtotal + taxAmount;
    await client.query(
      `INSERT INTO proforma_items (
        id, proforma_id, product_id, product_name, sku, description,
        quantity, unit_price, discount, tax_rate, tax_amount, subtotal, total, branch_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        String(item.id || newId()),
        proformaId,
        String(item.productId || item.product_id || ''),
        String(item.productName || item.product_name || item.description || ''),
        String(item.sku || ''),
        String(item.description || item.productName || item.product_name || ''),
        qty,
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

module.exports = function proformasRoutes(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const branchId = req.query.branchId ? String(req.query.branchId).trim() : '';
      let query = 'SELECT * FROM proformas';
      const params = [];
      if (branchId) {
        query += ' WHERE TRIM(COALESCE(branch_id, \'\')) = $1';
        params.push(branchId);
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      const rows = [];
      for (const row of result.rows || []) {
        const items = await loadItemsForProforma(row.id);
        rows.push(mapProformaRow(row, items));
      }
      res.json(rows);
    } catch (error) {
      console.error('[PROFORMAS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch pro formas' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM proformas WHERE id = $1 LIMIT 1', [req.params.id]);
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Pro forma not found' });
      }
      const items = await loadItemsForProforma(req.params.id);
      res.json(mapProformaRow(result.rows[0], items));
    } catch (error) {
      console.error('[PROFORMAS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch pro forma' });
    }
  });

  router.post('/', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const header = bodyToHeader(req.body);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO proformas (
          id, proforma_number, client_id, client_name, client_nif,
          customer_email, customer_phone, customer_address,
          branch_id, branch_name, subtotal, tax_amount, discount, total, currency,
          status, valid_until, notes, terms_and_conditions,
          converted_to_invoice_id, converted_to_invoice_number, converted_at,
          created_by, created_by_name, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
        )`,
        [
          header.id,
          header.proforma_number,
          header.client_id,
          header.client_name,
          header.client_nif,
          header.customer_email,
          header.customer_phone,
          header.customer_address,
          header.branch_id,
          header.branch_name,
          header.subtotal,
          header.tax_amount,
          header.discount,
          header.total,
          header.currency,
          header.status,
          header.valid_until,
          header.notes,
          header.terms_and_conditions,
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
      const itemsLoaded = await loadItemsForProforma(header.id);
      const saved = mapProformaRow(
        (await db.query('SELECT * FROM proformas WHERE id = $1', [header.id])).rows[0],
        itemsLoaded,
      );
      await broadcastTable('proformas');
      res.status(201).json(saved);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[PROFORMAS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to save pro forma' });
    } finally {
      client.release();
    }
  });

  router.put('/:id', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const id = req.params.id;
      const header = bodyToHeader({ ...req.body, id });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE proformas SET
          proforma_number = $1,
          client_id = $2,
          client_name = $3,
          client_nif = $4,
          customer_email = $5,
          customer_phone = $6,
          customer_address = $7,
          branch_id = $8,
          branch_name = $9,
          subtotal = $10,
          tax_amount = $11,
          discount = $12,
          total = $13,
          currency = $14,
          status = $15,
          valid_until = $16,
          notes = $17,
          terms_and_conditions = $18,
          converted_to_invoice_id = $19,
          converted_to_invoice_number = $20,
          converted_at = $21,
          created_by = $22,
          created_by_name = $23,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $24
        RETURNING *`,
        [
          header.proforma_number,
          header.client_id,
          header.client_name,
          header.client_nif,
          header.customer_email,
          header.customer_phone,
          header.customer_address,
          header.branch_id,
          header.branch_name,
          header.subtotal,
          header.tax_amount,
          header.discount,
          header.total,
          header.currency,
          header.status,
          header.valid_until,
          header.notes,
          header.terms_and_conditions,
          header.converted_to_invoice_id || null,
          header.converted_to_invoice_number || null,
          header.converted_at || null,
          header.created_by,
          header.created_by_name,
          id,
        ],
      );
      if (!updated.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pro forma not found' });
      }
      await replaceItems(client, id, items, header.branch_id);
      await client.query('COMMIT');
      const itemsLoaded = await loadItemsForProforma(id);
      const saved = mapProformaRow(updated.rows[0], itemsLoaded);
      await broadcastTable('proformas');
      res.json(saved);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[PROFORMAS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to update pro forma' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const result = await db.query(
        `DELETE FROM proformas WHERE id = $1 AND status != 'converted' RETURNING id`,
        [req.params.id],
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Pro forma not found or already converted' });
      }
      await broadcastTable('proformas');
      res.json({ success: true });
    } catch (error) {
      console.error('[PROFORMAS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete pro forma' });
    }
  });

  return router;
};
