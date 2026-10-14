/**
 * Unified AGT transmission — sales invoices, credit notes, debit notes.
 */
const crypto = require('crypto');
const db = require('../db');
const { getAgtConfigWithSecrets } = require('./agtConfig');
const { signFiscalEntity } = require('./fiscalSigning');
const { transmitDocument, checkDocumentStatus, shouldSimulate } = require('./connector');
const { buildRegistarFacturaPayload, agtDocumentType, formatDocumentNo } = require('./fePayload');
const { loadActiveSigningMaterial } = require('./certificateStore');
const { resolveSoftwareSigningKey } = require('./softwareKey');

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
    if (['FT', 'FR', 'FS', 'TV'].includes(t)) return t;
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
  if ((entityKind === 'credit_note' || entityKind === 'debit_note') && !doc.original_invoice_type) {
    doc.original_invoice_type = await loadOriginalInvoiceType(doc);
  }
  if (entityKind === 'credit_note' && !String(doc.original_invoice_number || '').trim()) {
    throw new Error('Nota de crédito sem factura de origem — a AGT exige a referência (E13)');
  }
  return buildRegistarFacturaPayload({
    config,
    entityKind,
    doc,
    items,
    meta,
    privateKeyPem: material.privateKeyPem,
    softwarePrivateKeyPem: resolveSoftwareSigningKey(material.privateKeyPem),
  });
}

async function loadOriginalInvoiceType(doc) {
  try {
    if (doc.original_invoice_id) {
      const res = await db.query('SELECT invoice_type FROM sales WHERE id = $1', [doc.original_invoice_id]);
      if (res.rows[0]?.invoice_type) return res.rows[0].invoice_type;
    }
    if (doc.original_invoice_number) {
      const res = await db.query(
        'SELECT invoice_type FROM sales WHERE invoice_number = $1 ORDER BY created_at DESC LIMIT 1',
        [doc.original_invoice_number],
      );
      if (res.rows[0]?.invoice_type) return res.rows[0].invoice_type;
    }
  } catch (e) {
    console.warn('[AGT] original invoice type lookup failed:', e.message);
  }
  return 'FT';
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

async function latestOpenTransmission(entityType, entityId) {
  const res = await db.query(
    `SELECT id, agt_status FROM agt_transmissions
     WHERE entity_type = $1 AND entity_id = $2
       AND COALESCE(transmission_type, '') != 'void'
     ORDER BY transmitted_at DESC, id DESC
     LIMIT 1`,
    [entityType, entityId],
  );
  return res.rows[0] || null;
}

async function upsertOpenTransmission({
  preferredId,
  entityType,
  entityId,
  invoiceId,
  invoiceNumber,
  transmissionType,
  payload,
}) {
  const body = JSON.stringify(payload);
  if (preferredId) {
    const existing = await db.query('SELECT id FROM agt_transmissions WHERE id = $1', [preferredId]);
    if (existing.rows.length) {
      await db.query(
        `UPDATE agt_transmissions
         SET request_payload = $1, invoice_number = $2, agt_status = 'pending',
             error_message = NULL, error_code = NULL, transmitted_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [body, invoiceNumber, preferredId],
      );
      return preferredId;
    }
  }
  const open = await latestOpenTransmission(entityType, entityId);
  const openStatus = String(open?.agt_status || '').toLowerCase();
  if (open && !['validated', 'approved', 'submitted', 'voided'].includes(openStatus)) {
    await db.query(
      `UPDATE agt_transmissions
       SET request_payload = $1, invoice_number = $2, agt_status = 'pending',
           error_message = NULL, error_code = NULL, transmitted_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [body, invoiceNumber, open.id],
    );
    return open.id;
  }
  const transmissionId = crypto.randomUUID();
  await db.query(
    `INSERT INTO agt_transmissions (
      id, invoice_id, invoice_number, transmission_type,
      entity_type, entity_id, request_payload, agt_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
    [transmissionId, invoiceId, invoiceNumber, transmissionType, entityType, entityId, body],
  );
  return transmissionId;
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
  const invoiceId = entityKind === 'sale' ? resolvedEntityId : doc.original_invoice_id || null;
  const transmissionId = await upsertOpenTransmission({
    preferredId: options.transmissionId,
    entityType: meta.entityType,
    entityId: resolvedEntityId,
    invoiceId,
    invoiceNumber: doc[meta.numberCol],
    transmissionType: meta.transmissionType,
    payload,
  });

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
      [err.message, String(err.code || err.status || 'TRANSMIT_ERROR'), transmissionId],
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

  return transmitFiscalEntity(kind, entityId, { force: true, transmissionId: row.id });
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
  if (!shouldSimulate(config) && row.document_number) {
    try {
      const material = await loadActiveSigningMaterial();
      const agtType = agtDocumentType(doc.invoice_type || doc.invoiceType || meta.docType, entityKind);
      remote = await checkDocumentStatus(formatDocumentNo(agtType, row.document_number), config, {
        requestId: doc.agt_request_id || (await latestRequestId(meta.entityType, doc.id)) || undefined,
        privateKeyPem: material?.privateKeyPem,
        softwarePrivateKeyPem: material?.privateKeyPem
          ? resolveSoftwareSigningKey(material.privateKeyPem)
          : undefined,
      });
      if (remote.agtStatus === 'validated' || remote.agtStatus === 'invalid') {
        await applyRemoteStatus(meta, doc.id, remote);
        row.agt_status = remote.agtStatus;
        if (remote.validatedAt) row.agt_validated_at = remote.validatedAt;
      }
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

async function latestRequestId(entityType, entityId) {
  try {
    const res = await db.query(
      `SELECT request_id FROM agt_transmissions
       WHERE entity_type = $1 AND entity_id = $2 AND request_id IS NOT NULL AND request_id <> ''
       ORDER BY transmitted_at DESC LIMIT 1`,
      [entityType, entityId],
    );
    return res.rows[0]?.request_id || null;
  } catch {
    return null;
  }
}

/**
 * Persist AGT's final answer. "invalid" is kept apart from "rejected"/"error" so the
 * reconcile worker does not resend the same number — AGT refuses that (E46); a corrected
 * document needs a new number.
 */
async function applyRemoteStatus(meta, entityId, remote) {
  const errorText = (remote.errors || [])
    .map((e) => `${e.code} ${e.description}`.trim())
    .filter(Boolean)
    .join('; ')
    .slice(0, 2000) || null;
  await db.query(
    `UPDATE ${meta.table}
     SET agt_status = $1, agt_validated_at = COALESCE($2, agt_validated_at)
     WHERE id = $3`,
    [remote.agtStatus, remote.validatedAt || null, entityId],
  );
  await db.query(
    `UPDATE agt_transmissions
     SET agt_status = $1, validated_at = COALESCE($2, validated_at),
         error_message = $3, error_code = $4, response_payload = COALESCE($5, response_payload)
     WHERE id = (
       SELECT id FROM agt_transmissions
       WHERE entity_type = $6 AND entity_id = $7 AND transmission_type != 'void'
       ORDER BY transmitted_at DESC LIMIT 1
     )`,
    [
      remote.agtStatus,
      remote.validatedAt || null,
      errorText,
      remote.agtStatus === 'invalid' ? String(remote.errors?.[0]?.code || 'INVALID') : null,
      remote.responsePayload ? JSON.stringify(remote.responsePayload) : null,
      meta.entityType,
      entityId,
    ],
  ).catch((e) => console.warn('[AGT] could not store remote status on transmission:', e.message));
  if (remote.agtStatus === 'invalid') {
    try {
      const { notifyAgtFailure } = require('../lib/notifications');
      await notifyAgtFailure({
        entityType: meta.entityType,
        entityId,
        message: errorText || 'Documento inválido na AGT',
      });
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = {
  ENTITY_MAP,
  transmitFiscalEntity,
  retryTransmission,
  getEntityAgtStatus,
};
