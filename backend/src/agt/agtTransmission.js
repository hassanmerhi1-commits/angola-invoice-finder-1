/**
 * Unified AGT transmission — sales invoices, credit notes, debit notes.
 */
const crypto = require('crypto');
const db = require('../db');
const { getAgtConfigWithSecrets } = require('./agtConfig');
const { signFiscalEntity } = require('./fiscalSigning');
const { transmitDocument, checkDocumentStatus, shouldSimulate } = require('./connector');
const { buildRegistarFacturaPayload } = require('./fePayload');
const { loadActiveSigningMaterial } = require('./certificateStore');

const ENTITY_MAP = {
  sale: {
    entityType: 'sale',
    table: 'sales',
    transmissionType: 'invoice',
    docType: 'FT',
    numberCol: 'invoice_number',
    dateCol: 'created_at',
  },
  credit_note: {
    entityType: 'credit_note',
    table: 'credit_notes',
    transmissionType: 'credit_note',
    docType: 'NC',
    numberCol: 'document_number',
    dateCol: 'issued_at',
  },
  debit_note: {
    entityType: 'debit_note',
    table: 'debit_notes',
    transmissionType: 'debit_note',
    docType: 'ND',
    numberCol: 'document_number',
    dateCol: 'issued_at',
  },
};

async function loadSignatureMeta(entityType, entityId) {
  const res = await db.query(
    `SELECT content_hash, signature_data, algorithm, previous_hash
     FROM fiscal_signatures
     WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, entityId],
  ).catch(() => ({ rows: [] }));
  return res.rows[0] || null;
}

async function loadItemsForSale(saleId) {
  const res = await db.query('SELECT * FROM sale_items WHERE sale_id = $1', [saleId]);
  return res.rows.map((item) => ({
    productName: item.product_name,
    sku: item.sku,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    taxRate: Number(item.tax_rate),
    taxAmount: Number(item.tax_amount),
    subtotal: Number(item.subtotal),
  }));
}

async function loadItemsForCreditNote(noteId) {
  const res = await db.query('SELECT * FROM credit_note_items WHERE credit_note_id = $1', [noteId]);
  return res.rows.map((item) => ({
    productName: item.product_name,
    sku: item.sku,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    taxRate: Number(item.tax_rate),
    taxAmount: Number(item.tax_amount),
    subtotal: Number(item.subtotal),
  }));
}

async function loadItemsForDebitNote(noteId) {
  const res = await db.query('SELECT * FROM debit_note_items WHERE debit_note_id = $1', [noteId]);
  return res.rows.map((item) => ({
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    taxRate: Number(item.tax_rate),
    taxAmount: Number(item.tax_amount),
    subtotal: Number(item.subtotal),
  }));
}

function resolveDocType(meta, doc) {
  if (meta.entityType === 'sale') {
    const t = String(doc.invoice_type || 'FT').toUpperCase();
    if (['FT', 'FR', 'FS'].includes(t)) return t;
  }
  return meta.docType;
}

function buildPayload(config, meta, doc, items, signature) {
  const issueDate = doc[meta.dateCol] || doc.created_at || new Date().toISOString();
  return {
    documentType: resolveDocType(meta, doc),
    documentNumber: doc[meta.numberCol],
    issueDate,
    emitterNif: config.companyNif || '',
    customerNif: doc.customer_nif || '999999990',
    customerName: doc.customer_name || 'Consumidor Final',
    subtotal: Number(doc.subtotal || 0),
    taxAmount: Number(doc.tax_amount || 0),
    total: Number(doc.total || 0),
    hash: doc.saft_hash || '',
    contentHash: signature?.content_hash || null,
    signature: signature?.signature_data || null,
    signatureAlgorithm: signature?.algorithm || 'SHA-256',
    softwareCertificate: config.softwareCertificateNumber || '',
    originalInvoiceNumber: doc.original_invoice_number || doc.invoice_number || undefined,
    items,
    environment: config.environment,
  };
}

async function buildLivePayload(config, meta, doc, items, entityKind) {
  const material = await loadActiveSigningMaterial();
  if (!material?.privateKeyPem) {
    throw new Error('Carregue o certificado PKCS#12 em Definições → Assinatura digital antes de enviar à AGT');
  }
  if (!String(config.companyNif || '').trim()) {
    throw new Error('NIF da empresa em falta nas definições AGT');
  }
  return buildRegistarFacturaPayload({
    config,
    entityKind,
    doc,
    items,
    meta,
    privateKeyPem: material.privateKeyPem,
  });
}

async function updateEntityAgtStatus(meta, entityId, result) {
  await db.query(
    `UPDATE ${meta.table}
     SET agt_status = $1, agt_code = $2, agt_validated_at = $3
     WHERE id = $4`,
    [result.agtStatus, result.agtCode, result.validatedAt, entityId],
  );
  if (result.atcud || result.requestId) {
    try {
      await db.query(
        `UPDATE ${meta.table}
         SET atcud = COALESCE($1, atcud), agt_request_id = COALESCE($2, agt_request_id)
         WHERE id = $3`,
        [result.atcud || null, result.requestId || null, entityId],
      );
    } catch (e) {
      console.warn('[AGT] atcud/request_id column missing:', e.message);
    }
  }
}

async function loadFiscalDocumentRow(meta, entityId, options = {}) {
  let docRes = await db.query(`SELECT * FROM ${meta.table} WHERE id = $1`, [entityId]);
  if (docRes.rows.length) return docRes.rows[0];

  const numberLookup = options.documentNumber || options.invoiceNumber;
  if (numberLookup && meta.numberCol) {
    docRes = await db.query(
      `SELECT * FROM ${meta.table} WHERE ${meta.numberCol} = $1 ORDER BY created_at DESC LIMIT 1`,
      [numberLookup],
    );
    if (docRes.rows.length) return docRes.rows[0];
  }

  return null;
}

async function transmitFiscalEntity(entityKind, entityId, options = {}) {
  const meta = ENTITY_MAP[entityKind];
  if (!meta) throw new Error(`Tipo de documento AGT não suportado: ${entityKind}`);

  const config = await getAgtConfigWithSecrets();
  const doc = await loadFiscalDocumentRow(meta, entityId, options);
  if (!doc) throw new Error('Factura não encontrada');
  const resolvedEntityId = doc.id;

  const currentStatus = String(doc.agt_status || '').toLowerCase();
  if (!options.force && ['validated', 'approved', 'submitted'].includes(currentStatus)) {
    return {
      skipped: true,
      agtCode: doc.agt_code,
      agtStatus: doc.agt_status,
      validatedAt: doc.agt_validated_at,
    };
  }

  if (!doc.saft_hash) {
    await signFiscalEntity(meta.entityType, resolvedEntityId);
    const reloaded = await db.query(`SELECT * FROM ${meta.table} WHERE id = $1`, [resolvedEntityId]);
    Object.assign(doc, reloaded.rows[0] || {});
  }

  const signature = await loadSignatureMeta(meta.entityType, resolvedEntityId);

  let items = [];
  if (entityKind === 'sale') items = await loadItemsForSale(resolvedEntityId);
  if (entityKind === 'credit_note') items = await loadItemsForCreditNote(resolvedEntityId);
  if (entityKind === 'debit_note') items = await loadItemsForDebitNote(resolvedEntityId);

  const payload = shouldSimulate(config)
    ? buildPayload(config, meta, doc, items, signature)
    : await buildLivePayload(config, meta, doc, items, entityKind);
  const transmissionId = crypto.randomUUID();
  const invoiceId = entityKind === 'sale' ? resolvedEntityId : doc.original_invoice_id || null;

  await db.query(
    `INSERT INTO agt_transmissions (
      id, invoice_id, invoice_number, transmission_type,
      entity_type, entity_id, request_payload, agt_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
    [
      transmissionId,
      invoiceId,
      doc[meta.numberCol],
      meta.transmissionType,
      meta.entityType,
      resolvedEntityId,
      JSON.stringify(payload),
    ],
  );

  try {
    const result = await transmitDocument(payload, config);
    await db.query(
      `UPDATE agt_transmissions
       SET response_payload = $1, agt_code = $2, agt_status = $3,
           validated_at = $4, error_message = NULL, error_code = NULL
       WHERE id = $5`,
      [
        JSON.stringify(result.responsePayload),
        result.agtCode,
        result.agtStatus,
        result.validatedAt,
        transmissionId,
      ],
    );
    try {
      await db.query(
        `UPDATE agt_transmissions SET request_id = COALESCE($1, request_id) WHERE id = $2`,
        [result.requestId || null, transmissionId],
      );
    } catch (_) { /* column may not exist yet */ }
    await updateEntityAgtStatus(meta, resolvedEntityId, result);
    return { transmissionId, entityId: resolvedEntityId, ...result };
  } catch (err) {
    await db.query(
      `UPDATE agt_transmissions
       SET agt_status = 'error', error_message = $1, error_code = $2,
           retry_count = COALESCE(retry_count, 0) + 1
       WHERE id = $3`,
      [err.message, String(err.status || 'TRANSMIT_ERROR'), transmissionId],
    );
    await db.query(
      `UPDATE ${meta.table} SET agt_status = 'rejected' WHERE id = $1`,
      [resolvedEntityId],
    );
    try {
      const { notifyAgtFailure } = require('../lib/notifications');
      await notifyAgtFailure({
        entityType: meta.entityType,
        entityId: resolvedEntityId,
        message: err.message || 'AGT transmission failed',
      });
    } catch (_) { /* non-fatal */ }
    throw err;
  }
}

async function retryTransmission(transmissionId) {
  const res = await db.query('SELECT * FROM agt_transmissions WHERE id = $1', [transmissionId]);
  if (!res.rows.length) throw new Error('Transmissão não encontrada');
  const row = res.rows[0];
  const entityType = row.entity_type;
  const entityId = row.entity_id;

  const kind = Object.keys(ENTITY_MAP).find((k) => ENTITY_MAP[k].entityType === entityType);
  if (!kind || !entityId) throw new Error('Transmissão sem documento associado');

  return transmitFiscalEntity(kind, entityId, { force: true });
}

async function getEntityAgtStatus(entityKind, entityId, options = {}) {
  const meta = ENTITY_MAP[entityKind];
  if (!meta) throw new Error('Tipo inválido');
  const doc = await loadFiscalDocumentRow(meta, entityId, options);
  if (!doc) throw new Error('Factura não encontrada');
  const row = {
    agt_status: doc.agt_status,
    agt_code: doc.agt_code,
    agt_validated_at: doc.agt_validated_at,
    document_number: doc[meta.numberCol],
  };

  const config = await getAgtConfigWithSecrets();
  let remote = null;
  if (!config.simulate && row.document_number) {
    try {
      remote = await checkDocumentStatus(row.document_number, config, {
        requestId: doc.agt_request_id || undefined,
      });
    } catch (e) {
      remote = { error: e.message };
    }
  }

  return {
    agtStatus: row.agt_status,
    agtCode: row.agt_code,
    agtValidatedAt: row.agt_validated_at,
    documentNumber: row.document_number,
    remote,
  };
}

module.exports = {
  ENTITY_MAP,
  transmitFiscalEntity,
  retryTransmission,
  getEntityAgtStatus,
};
