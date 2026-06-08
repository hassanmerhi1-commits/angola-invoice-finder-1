/**
 * Phase B3 — shop client → city server event handlers (idempotent).
 */
const db = require('../db');
const {
  processSale,
  processPayment,
  recordStockMovement,
} = require('../transactionEngine');
const { enqueueSaleCreated, enqueuePaymentCreated, enqueueStockMovementCreated, enqueuePurchaseInvoiceCreated } = require('./outbox');
const { upsertPurchaseInvoice } = require('./purchaseInvoiceUpsert');
const { applyCaixaClose } = require('./caixaIngest');
const { processTransactionBody } = require('../transactionProcessor');

async function ingestLogTableExists() {
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = 'client_ingest_log' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'client_ingest_log' LIMIT 1`
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function findIngestReceipt(idempotencyKey) {
  if (!(await ingestLogTableExists())) return null;
  const r = await db.query(
    `SELECT event_type, entity_id, branch_id FROM client_ingest_log WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey]
  );
  return r.rows[0] || null;
}

async function writeIngestReceipt(client, idempotencyKey, eventType, entityId, branchId) {
  if (!(await ingestLogTableExists())) return;
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  await q(
    `INSERT INTO client_ingest_log (idempotency_key, event_type, entity_id, branch_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [idempotencyKey, eventType, entityId || null, branchId || null]
  );
}

async function handleSaleCreated(poolClient, idempotencyKey, payload) {
  const receipt = await findIngestReceipt(idempotencyKey);
  if (receipt?.entity_id) {
    return { ok: true, duplicate: true, saleId: receipt.entity_id, eventType: 'sale.created' };
  }

  const dupSale = await db.query(
    `SELECT id FROM sales WHERE client_request_id = $1 LIMIT 1`,
    [idempotencyKey]
  );
  if (dupSale.rows.length > 0) {
    return { ok: true, duplicate: true, saleId: dupSale.rows[0].id, eventType: 'sale.created' };
  }

  const body = payload?.saleData || payload;
  body.clientRequestId = idempotencyKey;

  let sale;
  try {
    await poolClient.query('BEGIN');
    sale = await processSale(poolClient, body);
    if (sale.duplicate) {
      await poolClient.query('ROLLBACK');
      return { ok: true, duplicate: true, saleId: sale.id, eventType: 'sale.created' };
    }
    await poolClient.query('COMMIT');
  } catch (e) {
    await poolClient.query('ROLLBACK').catch(() => {});
    throw e;
  }

  await db.query(`UPDATE sales SET client_request_id = $1 WHERE id = $2`, [idempotencyKey, sale.id]);

  const agtStatus = body.agtStatus || body.agt_status;
  const agtCode = body.agtCode || body.agt_code;
  const saftHash = body.saftHash || body.saft_hash;
  if (agtStatus || agtCode || saftHash) {
    await db.query(
      `UPDATE sales SET
         agt_status = COALESCE($1, agt_status),
         agt_code = COALESCE($2, agt_code),
         saft_hash = COALESCE($3, saft_hash),
         agt_validated_at = COALESCE(agt_validated_at, CURRENT_TIMESTAMP)
       WHERE id = $4`,
      [agtStatus || null, agtCode || null, saftHash || null, sale.id]
    );
  }

  await enqueueSaleCreated(null, sale.id, body.branchId, idempotencyKey);
  await writeIngestReceipt(poolClient, idempotencyKey, 'sale.created', sale.id, body.branchId);

  return {
    ok: true,
    saleId: sale.id,
    invoiceNumber: sale.invoice_number,
    eventType: 'sale.created',
  };
}

async function handlePaymentCreated(poolClient, idempotencyKey, payload) {
  const receipt = await findIngestReceipt(idempotencyKey);
  if (receipt?.entity_id) {
    return { ok: true, duplicate: true, paymentId: receipt.entity_id, eventType: 'payment.created' };
  }

  const body = payload?.paymentData || payload;
  if (!body.branchId) throw new Error('payment.branchId obrigatório');
  body.reference = body.reference || `sync:${idempotencyKey}`;

  let payment;
  try {
    await poolClient.query('BEGIN');
    payment = await processPayment(poolClient, body);
    await poolClient.query('COMMIT');
  } catch (e) {
    await poolClient.query('ROLLBACK').catch(() => {});
    throw e;
  }

  await enqueuePaymentCreated(null, payment.id, body.branchId);
  await writeIngestReceipt(poolClient, idempotencyKey, 'payment.created', payment.id, body.branchId);

  return {
    ok: true,
    paymentId: payment.id,
    paymentNumber: payment.payment_number,
    eventType: 'payment.created',
  };
}

async function handleStockMovement(poolClient, idempotencyKey, payload) {
  const receipt = await findIngestReceipt(idempotencyKey);
  if (receipt?.entity_id) {
    return { ok: true, duplicate: true, movementId: receipt.entity_id, eventType: 'stock_movement' };
  }

  const body = payload?.movementData || payload;
  if (!body.productId || !body.warehouseId) {
    throw new Error('stock_movement requer productId e warehouseId');
  }

  let movement;
  try {
    await poolClient.query('BEGIN');
    movement = await recordStockMovement(poolClient, {
    productId: body.productId,
    warehouseId: body.warehouseId || body.branchId,
    movementType: body.movementType || body.movement_type,
    quantity: body.quantity,
    unitCost: body.unitCost ?? body.unit_cost,
    referenceType: body.referenceType || body.reference_type || 'client_sync',
    referenceId: body.referenceId || body.reference_id || idempotencyKey,
    referenceNumber: body.referenceNumber || body.reference_number || '',
    notes: body.notes || `client-sync:${idempotencyKey}`,
    createdBy: body.createdBy || body.created_by,
    });
    await poolClient.query('COMMIT');
  } catch (e) {
    await poolClient.query('ROLLBACK').catch(() => {});
    throw e;
  }

  await enqueueStockMovementCreated(null, movement.id, body.branchId || body.warehouseId);
  await writeIngestReceipt(
    poolClient,
    idempotencyKey,
    'stock_movement',
    movement.id,
    body.branchId || body.warehouseId
  );

  return { ok: true, movementId: movement.id, eventType: 'stock_movement' };
}

async function handlePurchaseInvoiceCreated(poolClient, idempotencyKey, payload) {
  const receipt = await findIngestReceipt(idempotencyKey);
  if (receipt?.entity_id) {
    return {
      ok: true,
      duplicate: true,
      purchaseInvoiceId: receipt.entity_id,
      eventType: 'purchase_invoice.created',
    };
  }

  const invoiceData = payload?.invoiceData || payload?.invoice;
  const transactionData = payload?.transactionData || payload?.transaction;
  if (!invoiceData?.id) throw new Error('purchase_invoice.id obrigatório');
  if (!transactionData) throw new Error('purchase_invoice.transactionData obrigatório');

  const branchId = invoiceData.branchId || invoiceData.branch_id || transactionData.branchId;

  let txResult;
  try {
    await poolClient.query('BEGIN');
    await upsertPurchaseInvoice(poolClient, invoiceData);
    txResult = await processTransactionBody(poolClient, transactionData);
    await poolClient.query('COMMIT');
  } catch (e) {
    await poolClient.query('ROLLBACK').catch(() => {});
    throw e;
  }

  if (txResult.alreadyProcessed) {
    await writeIngestReceipt(
      poolClient,
      idempotencyKey,
      'purchase_invoice.created',
      invoiceData.id,
      branchId
    );
    return {
      ok: true,
      duplicate: true,
      purchaseInvoiceId: invoiceData.id,
      eventType: 'purchase_invoice.created',
    };
  }

  await enqueuePurchaseInvoiceCreated(
    null,
    invoiceData.id,
    branchId,
    txResult.stockMovementIds
  );
  await writeIngestReceipt(
    poolClient,
    idempotencyKey,
    'purchase_invoice.created',
    invoiceData.id,
    branchId
  );

  return {
    ok: true,
    purchaseInvoiceId: invoiceData.id,
    invoiceNumber: invoiceData.invoiceNumber || invoiceData.invoice_number,
    eventType: 'purchase_invoice.created',
  };
}

async function handleCaixaClose(poolClient, idempotencyKey, payload) {
  const receipt = await findIngestReceipt(idempotencyKey);
  if (receipt?.entity_id) {
    return { ok: true, duplicate: true, sessionId: receipt.entity_id, eventType: 'caixa.close' };
  }

  const sessionId =
    payload?.sessionData?.id || payload?.session?.id || payload?.id;
  if (!sessionId) throw new Error('caixa.close requer session.id');

  const result = await applyCaixaClose(payload);
  if (result.skipped && result.reason !== 'duplicate') {
    throw new Error(result.reason || 'caixa.close falhou');
  }

  const branchId =
    payload?.sessionData?.branchId
    || payload?.session?.branchId
    || payload?.caixaData?.branchId
    || payload?.caixa?.branchId;

  await writeIngestReceipt(poolClient, idempotencyKey, 'caixa.close', sessionId, branchId);

  return {
    ok: true,
    sessionId,
    duplicate: !!result.skipped,
    eventType: 'caixa.close',
  };
}

const SUPPORTED_TYPES = new Set([
  'sale.created',
  'payment.created',
  'stock_movement',
  'purchase_invoice.created',
  'caixa.close',
]);

async function applyClientIngestEvent(poolClient, event) {
  const key = event.idempotencyKey || event.idempotency_key;
  const type = event.type || event.event_type;
  if (!key) return { ok: false, error: 'missing idempotencyKey' };
  if (!SUPPORTED_TYPES.has(type)) {
    return { ok: false, error: `unsupported type ${type}` };
  }

  const payload = event.payload || {};
  switch (type) {
    case 'sale.created':
      return handleSaleCreated(poolClient, key, payload);
    case 'payment.created':
      return handlePaymentCreated(poolClient, key, payload);
    case 'stock_movement':
      return handleStockMovement(poolClient, key, payload);
    case 'purchase_invoice.created':
      return handlePurchaseInvoiceCreated(poolClient, key, payload);
    case 'caixa.close':
      return handleCaixaClose(poolClient, key, payload);
    default:
      return { ok: false, error: `unsupported type ${type}` };
  }
}

module.exports = {
  applyClientIngestEvent,
  SUPPORTED_TYPES,
};
