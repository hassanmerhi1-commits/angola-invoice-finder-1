/**
 * Void (anular) an issued sales invoice — stock restore, journals, AGT void, audit.
 */
const crypto = require('crypto');
const db = require('../db');
const { createJournalEntry } = require('../accounting');
const { recordStockMovement, auditLog, validatePeriod } = require('../transactionEngine');
const { getAgtConfigWithSecrets } = require('./agtConfig');
const { transmitVoid } = require('./connector');
const { resolveBranchCaixaGlAccountCode, linkOrphanBranchCaixaAccounts } = require('../lib/resolveBranchCaixaGlAccount');
const { isCashPaymentMethod } = require('../lib/caixaCashRefund');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function voidFiscalInvoice(invoiceId, options = {}) {
  const reason = String(options.reason || '').trim();
  if (reason.length < 3) {
    throw new Error('Motivo de anulação é obrigatório (mínimo 3 caracteres)');
  }

  const saleRes = await db.query('SELECT * FROM sales WHERE id = $1', [invoiceId]);
  if (!saleRes.rows.length) throw new Error('Factura não encontrada');
  const sale = saleRes.rows[0];

  if (String(sale.status || '').toLowerCase() === 'voided') {
    throw new Error('Factura já está anulada');
  }
  if (String(sale.fiscal_status || 'issued') === 'cancelled') {
    throw new Error('Factura já está cancelada');
  }
  if (String(sale.fiscal_status || 'issued') !== 'issued') {
    throw new Error('Só é possível anular facturas emitidas');
  }

  const ncRes = await db.query(
    `SELECT id FROM credit_notes
     WHERE original_invoice_id = $1 AND status IN ('issued', 'transmitted')
     LIMIT 1`,
    [invoiceId],
  );
  if (ncRes.rows.length) {
    throw new Error('Factura tem nota de crédito emitida — use a NC em vez de anular');
  }

  const partialPay = await db.query(
    `SELECT id FROM open_items
     WHERE document_id = $1 AND document_type = 'invoice'
       AND status = 'partial' LIMIT 1`,
    [invoiceId],
  );
  if (partialPay.rows.length) {
    throw new Error('Factura com pagamento parcial — regularize antes de anular');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const today = new Date().toISOString().split('T')[0];
    await validatePeriod(client, today);

    const itemsRes = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [invoiceId]);
    let totalCOGS = 0;
    const branchId = sale.branch_id;
    const invoiceNumber = sale.invoice_number;
    const voidBy = options.userId || null;
    const voidByName = options.userName || 'System';

    for (const item of itemsRes.rows) {
      const productId = item.product_id;
      const qty = Number(item.quantity || 0);
      if (!productId || qty <= 0) continue;

      await recordStockMovement(client, {
        productId,
        warehouseId: branchId,
        movementType: 'IN',
        quantity: qty,
        unitCost: 0,
        referenceType: 'void',
        referenceId: invoiceId,
        referenceNumber: invoiceNumber,
        createdBy: voidBy,
        notes: reason,
      });

      const costRes = await client.query('SELECT cost FROM products WHERE id = $1', [productId]);
      if (costRes.rows.length) {
        totalCOGS += Number(costRes.rows[0].cost || 0) * qty;
      }
    }

    const subtotal = roundMoney(sale.subtotal);
    const taxAmount = roundMoney(sale.tax_amount);
    const total = roundMoney(sale.total);
    const paymentMethod = sale.payment_method || 'cash';

    let cashAccountCode = '431';
    if (isCashPaymentMethod(paymentMethod)) {
      await linkOrphanBranchCaixaAccounts(client);
      cashAccountCode = await resolveBranchCaixaGlAccountCode(client, {
        branchId,
        branchName: sale.branch_name,
        branchCode: sale.branch_code,
        saleId: invoiceId,
      });
    }

    const reverseLines = [
      { accountCode: cashAccountCode, description: `Anulação ${invoiceNumber}`, debit: 0, credit: total },
      { accountCode: '613', description: `Anulação receita ${invoiceNumber}`, debit: subtotal, credit: 0 },
    ];
    if (taxAmount > 0) {
      reverseLines.push({
        accountCode: '3452',
        description: `Anulação IVA ${invoiceNumber}`,
        debit: taxAmount,
        credit: 0,
      });
    }

    await createJournalEntry(client, {
      description: `Anulação factura ${invoiceNumber}`,
      referenceType: 'void',
      referenceId: invoiceId,
      branchId,
      createdBy: voidBy,
      lines: reverseLines,
    });

    if (totalCOGS > 0) {
      await createJournalEntry(client, {
        description: `Reposição stock anulação ${invoiceNumber}`,
        referenceType: 'void',
        referenceId: invoiceId,
        branchId,
        createdBy: voidBy,
        lines: [
          { accountCode: '261', description: 'Entrada mercadorias', debit: totalCOGS, credit: 0 },
          { accountCode: '711', description: 'CMV reverso', debit: 0, credit: totalCOGS },
        ],
      });
    }

    await client.query(
      `UPDATE open_items
       SET remaining_amount = 0, status = 'cleared', cleared_at = CURRENT_TIMESTAMP
       WHERE document_id = $1 AND document_type = 'invoice' AND status != 'cleared'`,
      [invoiceId],
    );

    const config = await getAgtConfigWithSecrets();
    const voidPayload = {
      documentType: 'VOID',
      documentNumber: invoiceNumber,
      originalDocumentNumber: invoiceNumber,
      originalDocumentType: String(sale.invoice_type || 'FT').toUpperCase(),
      reason,
      emitterNif: config.companyNif || '',
      customerNif: sale.customer_nif || '999999990',
      hash: sale.saft_hash || '',
      environment: config.environment,
    };

    const agtResult = await transmitVoid(voidPayload, config);
    const transmissionId = crypto.randomUUID();

    await client.query(
      `INSERT INTO agt_transmissions (
        id, invoice_id, invoice_number, transmission_type, entity_type, entity_id,
        request_payload, response_payload, agt_code, agt_status, validated_at
      ) VALUES ($1,$2,$3,'void','sale',$4,$5,$6,$7,$8,$9)`,
      [
        transmissionId,
        invoiceId,
        invoiceNumber,
        invoiceId,
        JSON.stringify(voidPayload),
        JSON.stringify(agtResult.responsePayload || {}),
        agtResult.agtCode || null,
        agtResult.agtStatus || 'voided',
        agtResult.validatedAt || new Date().toISOString(),
      ],
    );

    await client.query(
      `UPDATE sales
       SET status = 'voided',
           fiscal_status = 'cancelled',
           agt_status = COALESCE($1, agt_status)
       WHERE id = $2`,
      [agtResult.agtStatus || 'voided', invoiceId],
    );

    await auditLog(client, {
      tableName: 'sales',
      recordId: invoiceId,
      action: 'void',
      userId: voidBy,
      userName: voidByName,
      branchId,
      oldValues: { status: sale.status, fiscal_status: sale.fiscal_status },
      newValues: { status: 'voided', fiscal_status: 'cancelled', reason },
      description: `Factura ${invoiceNumber} anulada: ${reason}`,
    });

    await client.query('COMMIT');

    return {
      success: true,
      invoiceId,
      invoiceNumber,
      agtStatus: agtResult.agtStatus,
      agtCode: agtResult.agtCode,
      transmissionId,
      simulated: !!agtResult.responsePayload?.simulated,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { voidFiscalInvoice };
