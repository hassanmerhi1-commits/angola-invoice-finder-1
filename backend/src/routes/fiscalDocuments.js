// Fiscal documents API — credit notes, debit notes, transport guides (Phase 1 AGT)
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');
const {
  processCreditNote,
  processDebitNote,
  processTransportDocument,
} = require('../fiscalDocumentEngine');
const { signFiscalDocument } = require('../agt/signFiscalDocument');
const { enqueueCreditNoteCreated, enqueueDebitNoteCreated } = require('../sync/outbox');

function parseJson(val, fallback = []) {
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

function mapCreditNoteRow(row, items = []) {
  return {
    id: row.id,
    documentNumber: row.document_number,
    branchId: row.branch_id,
    branchName: row.branch_name,
    originalInvoiceId: row.original_invoice_id,
    originalInvoiceNumber: row.original_invoice_number,
    reason: row.reason,
    reasonDescription: row.reason_description,
    items: items.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      sku: i.sku,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      taxRate: Number(i.tax_rate),
      taxAmount: Number(i.tax_amount),
      subtotal: Number(i.subtotal),
    })),
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    customerNif: row.customer_nif,
    customerName: row.customer_name,
    status: row.status,
    restoreStock: row.restore_stock !== false && row.restore_stock !== 0,
    saftHash: row.saft_hash,
    agtStatus: row.agt_status,
    agtCode: row.agt_code,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  };
}

function mapDebitNoteRow(row, items = []) {
  return {
    id: row.id,
    documentNumber: row.document_number,
    branchId: row.branch_id,
    branchName: row.branch_name,
    originalInvoiceId: row.original_invoice_id || undefined,
    originalInvoiceNumber: row.original_invoice_number || undefined,
    reason: row.reason,
    reasonDescription: row.reason_description,
    items: items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      taxRate: Number(i.tax_rate),
      taxAmount: Number(i.tax_amount),
      subtotal: Number(i.subtotal),
    })),
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    customerNif: row.customer_nif,
    customerName: row.customer_name,
    status: row.status,
    saftHash: row.saft_hash,
    agtStatus: row.agt_status,
    agtCode: row.agt_code,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  };
}

function mapTransportRow(row) {
  return {
    id: row.id,
    documentNumber: row.document_number,
    branchId: row.branch_id,
    branchName: row.branch_name,
    type: row.doc_type,
    originAddress: row.origin_address,
    originCity: row.origin_city,
    destinationAddress: row.destination_address,
    destinationCity: row.destination_city,
    destinationNif: row.destination_nif,
    destinationName: row.destination_name,
    transporterName: row.transporter_name,
    transporterNif: row.transporter_nif,
    vehiclePlate: row.vehicle_plate,
    loadingDate: row.loading_date,
    loadingTime: row.loading_time,
    items: parseJson(row.items_json, []),
    totalWeight: row.total_weight != null ? Number(row.total_weight) : undefined,
    totalVolume: row.total_volume != null ? Number(row.total_volume) : undefined,
    status: row.status,
    relatedInvoiceId: row.related_invoice_id,
    relatedInvoiceNumber: row.related_invoice_number,
    notes: row.notes,
    saftHash: row.saft_hash,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

async function loadCreditNote(id) {
  const noteRes = await db.query('SELECT * FROM credit_notes WHERE id = $1', [id]);
  if (!noteRes.rows.length) return null;
  const itemsRes = await db.query('SELECT * FROM credit_note_items WHERE credit_note_id = $1', [id]);
  return mapCreditNoteRow(noteRes.rows[0], itemsRes.rows);
}

async function loadDebitNote(id) {
  const noteRes = await db.query('SELECT * FROM debit_notes WHERE id = $1', [id]);
  if (!noteRes.rows.length) return null;
  const itemsRes = await db.query('SELECT * FROM debit_note_items WHERE debit_note_id = $1', [id]);
  return mapDebitNoteRow(noteRes.rows[0], itemsRes.rows);
}

module.exports = function fiscalDocumentsRouter(broadcastTable) {
  const router = express.Router();

  router.get('/credit-notes', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM credit_notes WHERE 1=1';
      const params = [];
      if (branchId) {
        params.push(branchId);
        query += ` AND branch_id = $${params.length}`;
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      const notes = [];
      for (const row of result.rows) {
        const itemsRes = await db.query(
          'SELECT * FROM credit_note_items WHERE credit_note_id = $1',
          [row.id],
        );
        notes.push(mapCreditNoteRow(row, itemsRes.rows));
      }
      res.json(notes);
    } catch (err) {
      console.error('[FISCAL credit-notes list]', err);
      res.status(500).json({ error: 'Failed to list credit notes' });
    }
  });

  router.post('/credit-notes', requireAuth, requirePermission('credit_note_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const body = {
        ...req.body,
        issuedBy: req.body.issuedBy || req.user.id,
        issuedByName: req.body.issuedByName || req.user.name,
        branchId: req.body.branchId || req.user.branchId,
      };
      const note = await processCreditNote(client, body);
      try {
        await enqueueCreditNoteCreated(client, note.id, body.branchId);
      } catch (enqueueErr) {
        console.warn('[FISCAL] credit note AGT enqueue:', enqueueErr.message);
      }
      await client.query('COMMIT');
      try {
        await signFiscalDocument('credit_notes', note.id, 'document_number', 'saft_hash');
      } catch (e) {
        console.warn('[FISCAL] credit note sign:', e.message);
      }
      const full = await loadCreditNote(note.id);
      await logFiscalEventFromReq(req, {
        tableName: 'credit_notes',
        recordId: note.id,
        action: 'issue',
        description: `Nota de Crédito ${note.documentNumber || full?.documentNumber || ''} emitida`,
        newValues: {
          documentNumber: note.documentNumber || full?.documentNumber,
          total: note.total ?? full?.total,
          originalInvoiceId: body.originalInvoiceId,
          restoreStock: body.restoreStock !== false,
        },
      });
      try {
        if (broadcastTable) {
          broadcastTable('credit_notes');
          broadcastTable('products');
        }
      } catch (broadcastErr) {
        console.warn('[FISCAL] broadcast after credit note:', broadcastErr.message);
      }
      res.status(201).json(full);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[FISCAL credit-notes create]', err);
      res.status(400).json({ error: err.message || 'Failed to create credit note' });
    } finally {
      client.release();
    }
  });

  router.post('/credit-notes/:id/cancel', async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE credit_notes SET status = 'cancelled'
         WHERE id = $1 AND status = 'draft' RETURNING id`,
        [req.params.id],
      );
      if (!result.rows.length) {
        return res.status(400).json({ error: 'Only draft credit notes can be cancelled' });
      }
      await broadcastTable('credit_notes');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/debit-notes', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM debit_notes WHERE 1=1';
      const params = [];
      if (branchId) {
        params.push(branchId);
        query += ` AND branch_id = $${params.length}`;
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      const notes = [];
      for (const row of result.rows) {
        const itemsRes = await db.query(
          'SELECT * FROM debit_note_items WHERE debit_note_id = $1',
          [row.id],
        );
        notes.push(mapDebitNoteRow(row, itemsRes.rows));
      }
      res.json(notes);
    } catch (err) {
      res.status(500).json({ error: 'Failed to list debit notes' });
    }
  });

  router.post('/debit-notes', requireAuth, requirePermission('debit_note_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const body = {
        ...req.body,
        issuedBy: req.body.issuedBy || req.user.id,
        issuedByName: req.body.issuedByName || req.user.name,
        branchId: req.body.branchId || req.user.branchId,
      };
      const note = await processDebitNote(client, body);
      try {
        await enqueueDebitNoteCreated(client, note.id, body.branchId);
      } catch (enqueueErr) {
        console.warn('[FISCAL] debit note AGT enqueue:', enqueueErr.message);
      }
      await client.query('COMMIT');
      try {
        await signFiscalDocument('debit_notes', note.id, 'document_number', 'saft_hash');
      } catch (e) {
        console.warn('[FISCAL] debit note sign:', e.message);
      }
      const full = await loadDebitNote(note.id);
      await logFiscalEventFromReq(req, {
        tableName: 'debit_notes',
        recordId: note.id,
        action: 'issue',
        description: `Nota de Débito ${note.documentNumber || full?.documentNumber || ''} emitida`,
        newValues: {
          documentNumber: note.documentNumber || full?.documentNumber,
          total: note.total ?? full?.total,
        },
      });
      await broadcastTable('debit_notes');
      res.status(201).json(full);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: err.message || 'Failed to create debit note' });
    } finally {
      client.release();
    }
  });

  router.get('/transport-documents', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM transport_documents WHERE 1=1';
      const params = [];
      if (branchId) {
        params.push(branchId);
        query += ` AND branch_id = $${params.length}`;
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      res.json(result.rows.map(mapTransportRow));
    } catch (err) {
      res.status(500).json({ error: 'Failed to list transport documents' });
    }
  });

  router.post('/transport-documents', requireAuth, requirePermission('invoice_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const body = {
        ...req.body,
        issuedBy: req.body.issuedBy || req.user.id,
        issuedByName: req.body.issuedByName || req.user.name,
        branchId: req.body.branchId || req.user.branchId,
      };
      const doc = await processTransportDocument(client, body);
      await client.query('COMMIT');
      try {
        await signFiscalDocument('transport_documents', doc.id, 'document_number', 'saft_hash');
      } catch (e) {
        console.warn('[FISCAL] transport sign:', e.message);
      }
      const loaded = await db.query('SELECT * FROM transport_documents WHERE id = $1', [doc.id]);
      await broadcastTable('transport_documents');
      res.status(201).json(mapTransportRow(loaded.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: err.message || 'Failed to create transport document' });
    } finally {
      client.release();
    }
  });

  router.patch('/transport-documents/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      const allowed = new Set(['in_transit', 'delivered', 'cancelled']);
      if (!allowed.has(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const deliveredAt = status === 'delivered' ? new Date().toISOString() : null;
      const result = await db.query(
        `UPDATE transport_documents
         SET status = $1, delivered_at = COALESCE($2, delivered_at)
         WHERE id = $3 RETURNING *`,
        [status, deliveredAt, req.params.id],
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
      await broadcastTable('transport_documents');
      res.json(mapTransportRow(result.rows[0]));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
