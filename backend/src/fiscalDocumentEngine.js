/**
 * Fiscal document processors — credit notes, debit notes, transport guides.
 * Issued sales invoices are immutable; corrections flow through these documents.
 */
const { randomUUID } = require('crypto');
const {
  createJournalEntry,
  generateSequenceNumber,
} = require('./accounting');
const {
  recordStockMovement,
  auditLog,
  validatePeriod,
  linkDocuments,
} = require('./transactionEngine');
const { ensureCreditNoteRestoreStockColumn } = require('./lib/ensurePhaseSchema');
const db = require('./db');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function requireParam(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Parâmetro obrigatório em falta: ${name}`);
  }
  return value;
}

async function reduceCustomerInvoiceOpenItem(client, invoiceDocumentId, amount) {
  const reduction = Number(amount || 0);
  if (!invoiceDocumentId || reduction <= 0) return null;

  const result = await client.query(
    `SELECT id, remaining_amount, document_number
     FROM open_items
     WHERE entity_type = 'customer'
       AND document_id = $1
       AND status != 'cleared'
     ORDER BY created_at ASC
     LIMIT 1`,
    [invoiceDocumentId],
  );
  if (!result.rows.length) return null;

  const row = result.rows[0];
  const applied = Math.min(reduction, Number(row.remaining_amount || 0));
  if (applied <= 0) return null;

  await client.query(
    `UPDATE open_items SET
       remaining_amount = remaining_amount - $1,
       status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
       cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE cleared_at END
     WHERE id = $2`,
    [applied, row.id],
  );
  return { id: row.id, applied, documentNumber: row.document_number };
}

async function processCreditNote(client, data) {
  await ensureCreditNoteRestoreStockColumn(db);

  const {
    branchId: branchIdInput,
    branchCode: branchCodeInput,
    branchName: branchNameInput,
    originalInvoiceId,
    reason,
    reasonDescription,
    items,
    issuedBy,
    issuedByName,
    restoreStock: restoreStockInput = true,
    restore_stock: restoreStockSnake,
  } = data;

  const restoreStock = restoreStockInput !== false
    && restoreStockSnake !== false
    && restoreStockSnake !== 0
    && restoreStockSnake !== '0';

  requireParam(originalInvoiceId, 'originalInvoiceId');
  requireParam(reason, 'reason');
  if (!items || items.length === 0) throw new Error('Nota de crédito deve ter pelo menos um item');

  const saleRes = await client.query(
    `SELECT * FROM sales WHERE id = $1 LIMIT 1`,
    [originalInvoiceId],
  );
  if (!saleRes.rows.length) throw new Error('Fatura original não encontrada');
  const sale = saleRes.rows[0];
  if (String(sale.fiscal_status || 'issued') === 'cancelled') {
    throw new Error('Fatura original está cancelada');
  }

  const branchId = branchIdInput || sale.branch_id;
  requireParam(branchId, 'branchId');
  const branchCode = branchCodeInput || sale.branch_code || 'SEDE';
  const branchName = branchNameInput || sale.branch_name || '';

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  const documentNumber = await generateSequenceNumber(client, 'credit_note', 'NC', {
    branchId,
    branchCode: branchCode || 'SEDE',
  });

  const subtotal = roundMoney(items.reduce((s, i) => s + Number(i.subtotal || 0), 0));
  const taxAmount = roundMoney(items.reduce((s, i) => s + Number(i.taxAmount || i.tax_amount || 0), 0));
  const total = roundMoney(subtotal + taxAmount);

  const noteId = randomUUID();
  const issuedAt = new Date().toISOString();

  await client.query(
    `INSERT INTO credit_notes (
      id, document_number, branch_id, branch_name,
      original_invoice_id, original_invoice_number,
      reason, reason_description,
      subtotal, tax_amount, total,
      customer_nif, customer_name,
      status, restore_stock, issued_by, issued_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'issued',$14,$15,$16)`,
    [
      noteId,
      documentNumber,
      branchId,
      branchName || '',
      originalInvoiceId,
      sale.invoice_number,
      reason,
      reasonDescription || '',
      subtotal,
      taxAmount,
      total,
      sale.customer_nif,
      sale.customer_name,
      restoreStock !== false,
      issuedBy,
      issuedAt,
    ],
  );

  let totalCOGS = 0;
  for (const item of items) {
    const lineId = randomUUID();
    const qty = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || item.unit_price || 0);
    const taxRate = Number(item.taxRate || item.tax_rate || 0);
    const lineTax = roundMoney(Number(item.taxAmount || item.tax_amount || 0));
    const lineSub = roundMoney(Number(item.subtotal || 0));
    const productId = item.productId || item.product_id || null;

    await client.query(
      `INSERT INTO credit_note_items (
        id, credit_note_id, product_id, product_name, sku,
        quantity, unit_price, tax_rate, tax_amount, subtotal
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        lineId,
        noteId,
        productId,
        item.productName || item.product_name || '',
        item.sku || '',
        qty,
        unitPrice,
        taxRate,
        lineTax,
        lineSub,
      ],
    );

    if (restoreStock && productId && qty > 0) {
      await recordStockMovement(client, {
        productId,
        warehouseId: branchId,
        movementType: 'IN',
        quantity: qty,
        unitCost: 0,
        referenceType: 'sale_return',
        referenceId: noteId,
        referenceNumber: documentNumber,
        createdBy: issuedBy,
        notes: reasonDescription || `NC ${documentNumber}`,
      });
      const costRes = await client.query('SELECT cost FROM products WHERE id = $1', [productId]);
      if (costRes.rows.length) {
        totalCOGS += Number(costRes.rows[0].cost || 0) * qty;
      }
    }
  }

  const journalLines = [
    { accountCode: '7.1.1', description: `NC ${documentNumber}`, debit: subtotal, credit: 0 },
  ];
  if (taxAmount > 0) {
    journalLines.push({ accountCode: '3.3.1', description: `IVA NC ${documentNumber}`, debit: taxAmount, credit: 0 });
  }
  journalLines.push({
    accountCode: sale.payment_method === 'cash' ? '4.1.1' : '4.2.1',
    description: `NC ${documentNumber}`,
    debit: 0,
    credit: total,
  });

  await createJournalEntry(client, {
    description: `Nota de Crédito ${documentNumber}`,
    referenceType: 'credit_note',
    referenceId: noteId,
    branchId,
    createdBy: issuedBy,
    lines: journalLines,
  });

  if (totalCOGS > 0) {
    await createJournalEntry(client, {
      description: `Reposição stock NC ${documentNumber}`,
      referenceType: 'credit_note',
      referenceId: noteId,
      branchId,
      createdBy: issuedBy,
      lines: [
        { accountCode: '2.2', description: 'Entrada mercadorias', debit: totalCOGS, credit: 0 },
        { accountCode: '6.1', description: 'CMV reverso', debit: 0, credit: totalCOGS },
      ],
    });
  }

  await reduceCustomerInvoiceOpenItem(client, originalInvoiceId, total);

  await linkDocuments(
    client,
    'credit_note',
    noteId,
    documentNumber,
    'invoice',
    originalInvoiceId,
    sale.invoice_number,
  );

  await auditLog(client, {
    tableName: 'credit_notes',
    recordId: noteId,
    action: 'issue',
    userId: issuedBy,
    userName: issuedByName,
    branchId,
    newValues: { documentNumber, total, originalInvoiceId, restoreStock: restoreStock !== false },
    description: `Nota de Crédito ${documentNumber} sobre ${sale.invoice_number}`,
  });

  return {
    id: noteId,
    document_number: documentNumber,
    documentNumber,
    subtotal,
    tax_amount: taxAmount,
    taxAmount,
    total,
    status: 'issued',
    issued_at: issuedAt,
    issuedAt,
    original_invoice_id: originalInvoiceId,
    original_invoice_number: sale.invoice_number,
    originalInvoiceId,
    originalInvoiceNumber: sale.invoice_number,
    customer_nif: sale.customer_nif,
    customerNif: sale.customer_nif,
    customer_name: sale.customer_name,
    customerName: sale.customer_name,
    branch_id: branchId,
    branchId,
    branch_name: branchName,
    branchName,
    reason,
    reason_description: reasonDescription,
    reasonDescription,
    items,
  };
}

async function processDebitNote(client, data) {
  const {
    branchId,
    branchCode,
    branchName,
    originalInvoiceId,
    reason,
    reasonDescription,
    items,
    issuedBy,
    issuedByName,
    customerNif,
    customerName,
  } = data;

  requireParam(branchId, 'branchId');
  requireParam(reason, 'reason');
  if (!items || items.length === 0) throw new Error('Nota de débito deve ter pelo menos um item');

  let originalInvoiceNumber = null;
  if (originalInvoiceId) {
    const saleRes = await client.query('SELECT invoice_number, fiscal_status FROM sales WHERE id = $1', [originalInvoiceId]);
    if (!saleRes.rows.length) throw new Error('Fatura original não encontrada');
    if (String(saleRes.rows[0].fiscal_status || 'issued') === 'cancelled') {
      throw new Error('Fatura original está cancelada');
    }
    originalInvoiceNumber = saleRes.rows[0].invoice_number;
  }

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  const documentNumber = await generateSequenceNumber(client, 'debit_note', 'ND', {
    branchId,
    branchCode: branchCode || 'SEDE',
  });

  const subtotal = roundMoney(items.reduce((s, i) => s + Number(i.subtotal || 0), 0));
  const taxAmount = roundMoney(items.reduce((s, i) => s + Number(i.taxAmount || i.tax_amount || 0), 0));
  const total = roundMoney(subtotal + taxAmount);

  const noteId = randomUUID();
  const issuedAt = new Date().toISOString();

  await client.query(
    `INSERT INTO debit_notes (
      id, document_number, branch_id, branch_name,
      original_invoice_id, original_invoice_number,
      reason, reason_description,
      subtotal, tax_amount, total,
      customer_nif, customer_name,
      status, issued_by, issued_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'issued',$14,$15)`,
    [
      noteId,
      documentNumber,
      branchId,
      branchName || '',
      originalInvoiceId || null,
      originalInvoiceNumber,
      reason,
      reasonDescription || '',
      subtotal,
      taxAmount,
      total,
      customerNif || null,
      customerName || null,
      issuedBy,
      issuedAt,
    ],
  );

  for (const item of items) {
    const lineId = randomUUID();
    await client.query(
      `INSERT INTO debit_note_items (
        id, debit_note_id, description, quantity, unit_price, tax_rate, tax_amount, subtotal
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        lineId,
        noteId,
        item.description || '',
        Number(item.quantity || 1),
        Number(item.unitPrice || item.unit_price || 0),
        Number(item.taxRate || item.tax_rate || 0),
        roundMoney(Number(item.taxAmount || item.tax_amount || 0)),
        roundMoney(Number(item.subtotal || 0)),
      ],
    );
  }

  const journalLines = [
    {
      accountCode: '4.2.1',
      description: `ND ${documentNumber}`,
      debit: total,
      credit: 0,
    },
    { accountCode: '7.1.1', description: `ND ${documentNumber}`, debit: 0, credit: subtotal },
  ];
  if (taxAmount > 0) {
    journalLines.push({ accountCode: '3.3.1', description: `IVA ND ${documentNumber}`, debit: 0, credit: taxAmount });
  }

  await createJournalEntry(client, {
    description: `Nota de Débito ${documentNumber}`,
    referenceType: 'debit_note',
    referenceId: noteId,
    branchId,
    createdBy: issuedBy,
    lines: journalLines,
  });

  if (originalInvoiceId && originalInvoiceNumber) {
    await linkDocuments(
      client,
      'debit_note',
      noteId,
      documentNumber,
      'invoice',
      originalInvoiceId,
      originalInvoiceNumber,
    );
  }

  await auditLog(client, {
    tableName: 'debit_notes',
    recordId: noteId,
    action: 'issue',
    userId: issuedBy,
    userName: issuedByName,
    branchId,
    newValues: { documentNumber, total, originalInvoiceId },
    description: `Nota de Débito ${documentNumber}`,
  });

  return {
    id: noteId,
    document_number: documentNumber,
    documentNumber,
    subtotal,
    tax_amount: taxAmount,
    taxAmount,
    total,
    status: 'issued',
    issued_at: issuedAt,
    issuedAt,
    original_invoice_id: originalInvoiceId,
    originalInvoiceId,
    original_invoice_number: originalInvoiceNumber,
    originalInvoiceNumber,
    customer_nif: customerNif,
    customerNif,
    customer_name: customerName,
    customerName,
    branch_id: branchId,
    branchId,
    branch_name: branchName,
    branchName,
    reason,
    reason_description: reasonDescription,
    reasonDescription,
    items,
  };
}

async function processTransportDocument(client, data) {
  const {
    branchId,
    branchCode,
    branchName,
    type,
    originAddress,
    originCity,
    destinationAddress,
    destinationCity,
    loadingDate,
    loadingTime,
    items,
    issuedBy,
    issuedByName,
    destinationNif,
    destinationName,
    transporterName,
    transporterNif,
    vehiclePlate,
    relatedInvoiceId,
    relatedInvoiceNumber,
    notes,
    totalWeight,
    totalVolume,
  } = data;

  requireParam(branchId, 'branchId');
  requireParam(type, 'type');
  requireParam(loadingDate, 'loadingDate');
  if (!items || items.length === 0) throw new Error('Guia de transporte deve ter pelo menos um item');

  const documentNumber = await generateSequenceNumber(client, 'transport_document', 'GT', {
    branchId,
    branchCode: branchCode || 'SEDE',
  });

  const docId = randomUUID();
  const issuedAt = new Date().toISOString();

  await client.query(
    `INSERT INTO transport_documents (
      id, document_number, branch_id, branch_name, doc_type,
      origin_address, origin_city, destination_address, destination_city,
      destination_nif, destination_name,
      transporter_name, transporter_nif, vehicle_plate,
      loading_date, loading_time, items_json,
      total_weight, total_volume, status,
      related_invoice_id, related_invoice_number, notes,
      issued_by, issued_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'issued',$20,$21,$22,$23,$24
    )`,
    [
      docId,
      documentNumber,
      branchId,
      branchName || '',
      type,
      originAddress || '',
      originCity || '',
      destinationAddress || '',
      destinationCity || '',
      destinationNif || null,
      destinationName || null,
      transporterName || null,
      transporterNif || null,
      vehiclePlate || null,
      loadingDate,
      loadingTime || '08:00',
      JSON.stringify(items),
      totalWeight || null,
      totalVolume || null,
      relatedInvoiceId || null,
      relatedInvoiceNumber || null,
      notes || null,
      issuedBy,
      issuedAt,
    ],
  );

  await auditLog(client, {
    tableName: 'transport_documents',
    recordId: docId,
    action: 'issue',
    userId: issuedBy,
    userName: issuedByName,
    branchId,
    newValues: { documentNumber, type },
    description: `Guia de Transporte ${documentNumber}`,
  });

  return {
    id: docId,
    document_number: documentNumber,
    documentNumber,
    branch_id: branchId,
    branchId,
    branch_name: branchName,
    branchName,
    type,
    status: 'issued',
    issued_at: issuedAt,
    issuedAt,
    items,
  };
}

module.exports = {
  processCreditNote,
  processDebitNote,
  processTransportDocument,
};
