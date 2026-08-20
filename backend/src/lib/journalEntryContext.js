/**
 * Enrich journal entries with source-document context for audit / journal UI.
 */

function summarizeItems(items, maxNames = 2) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const names = items
    .map((it) => String(it.name || it.product_name || it.productName || it.description || '').trim())
    .filter(Boolean);
  if (names.length === 0) return `${items.length} item(s)`;
  if (names.length <= maxNames) return names.join(', ');
  const rest = names.length - maxNames;
  return `${names.slice(0, maxNames).join(', ')} +${rest}`;
}

function mapLineItem(row) {
  return {
    name: row.product_name || row.description || row.name || '',
    sku: row.sku || '',
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price ?? row.unitPrice) || 0,
    subtotal: Number(row.subtotal) || 0,
  };
}

async function loadSaleContext(db, referenceId) {
  const saleRes = await db.query(
    `SELECT s.id, s.invoice_number, s.payment_method,
            COALESCE(NULLIF(TRIM(s.customer_name), ''), NULLIF(TRIM(c.name), '')) AS customer_name,
            COALESCE(NULLIF(TRIM(s.customer_nif), ''), NULLIF(TRIM(c.nif), '')) AS customer_nif,
            s.invoice_type, s.total, s.subtotal, s.tax_amount, s.created_at,
            b.name AS branch_name
     FROM sales s
     LEFT JOIN branches b ON s.branch_id = b.id
     LEFT JOIN clients c ON s.client_id = c.id
     WHERE s.id = $1
     LIMIT 1`,
    [referenceId],
  );
  if (!saleRes.rows.length) return null;
  const sale = saleRes.rows[0];
  const itemsRes = await db.query(
    `SELECT product_name, sku, quantity, unit_price, subtotal
     FROM sale_items WHERE sale_id = $1 ORDER BY created_at`,
    [referenceId],
  );
  const items = itemsRes.rows.map(mapLineItem);
  return {
    documentType: 'sale',
    documentNumber: sale.invoice_number,
    documentDate: sale.created_at,
    paymentMethod: sale.payment_method,
    customerName: sale.customer_name,
    customerNif: sale.customer_nif,
    invoiceType: sale.invoice_type,
    total: Number(sale.total) || 0,
    branchName: sale.branch_name,
    items,
    itemsSummary: summarizeItems(items),
  };
}

async function loadCreditNoteContext(db, referenceId) {
  const res = await db.query(
    `SELECT document_number, original_invoice_number, customer_name, reason,
            reason_description, total, branch_name, issued_at
     FROM credit_notes WHERE id = $1 LIMIT 1`,
    [referenceId],
  );
  if (!res.rows.length) return null;
  const note = res.rows[0];
  const itemsRes = await db.query(
    `SELECT product_name, sku, quantity, unit_price, subtotal
     FROM credit_note_items WHERE credit_note_id = $1`,
    [referenceId],
  );
  const items = itemsRes.rows.map(mapLineItem);
  return {
    documentType: 'credit_note',
    documentNumber: note.document_number,
    documentDate: note.issued_at,
    customerName: note.customer_name,
    reason: note.reason,
    reasonDescription: note.reason_description,
    relatedDocument: note.original_invoice_number
      ? { type: 'invoice', number: note.original_invoice_number }
      : null,
    total: Number(note.total) || 0,
    branchName: note.branch_name,
    items,
    itemsSummary: summarizeItems(items),
  };
}

async function loadDebitNoteContext(db, referenceId) {
  const res = await db.query(
    `SELECT document_number, original_invoice_number, customer_name, reason,
            reason_description, total, branch_name, issued_at
     FROM debit_notes WHERE id = $1 LIMIT 1`,
    [referenceId],
  );
  if (!res.rows.length) return null;
  const note = res.rows[0];
  const itemsRes = await db.query(
    `SELECT description AS product_name, quantity, unit_price, subtotal
     FROM debit_note_items WHERE debit_note_id = $1`,
    [referenceId],
  );
  const items = itemsRes.rows.map(mapLineItem);
  return {
    documentType: 'debit_note',
    documentNumber: note.document_number,
    documentDate: note.issued_at,
    customerName: note.customer_name,
    reason: note.reason,
    reasonDescription: note.reason_description,
    relatedDocument: note.original_invoice_number
      ? { type: 'invoice', number: note.original_invoice_number }
      : null,
    total: Number(note.total) || 0,
    branchName: note.branch_name,
    items,
    itemsSummary: summarizeItems(items),
  };
}

async function loadPaymentContext(db, referenceId) {
  const res = await db.query(
    `SELECT p.payment_number, p.payment_type, p.entity_type, p.entity_id,
            COALESCE(
              NULLIF(TRIM(p.entity_name), ''),
              CASE
                WHEN p.entity_type = 'supplier' THEN s.name
                WHEN p.entity_type = 'customer' THEN c.name
                ELSE NULL
              END
            ) AS entity_name,
            p.payment_method, p.amount, p.reference, p.notes, p.created_at, p.posted_at,
            b.name AS branch_name
     FROM payments p
     LEFT JOIN branches b ON p.branch_id = b.id
     LEFT JOIN suppliers s ON p.entity_type = 'supplier' AND s.id = p.entity_id
     LEFT JOIN clients c ON p.entity_type = 'customer' AND c.id = p.entity_id
     WHERE p.id = $1 LIMIT 1`,
    [referenceId],
  );
  if (!res.rows.length) return null;
  const p = res.rows[0];
  const entityType = String(p.entity_type || '').toLowerCase();
  const entityName = String(p.entity_name || '').trim();
  return {
    documentType: p.payment_type === 'receipt' ? 'payment_receipt' : 'payment_out',
    documentNumber: p.payment_number,
    documentDate: p.posted_at || p.created_at,
    entityType,
    entityName,
    supplierName: entityType === 'supplier' ? entityName : undefined,
    customerName: entityType === 'customer' ? entityName : undefined,
    paymentMethod: p.payment_method,
    total: Number(p.amount) || 0,
    reference: p.reference,
    notes: p.notes,
    branchName: p.branch_name,
  };
}

async function loadPurchaseInvoiceContext(db, referenceId) {
  const res = await db.query(
    `SELECT invoice_number, supplier_name, supplier_nif, date, total, subtotal,
            iva_total, warehouse_name, branch_name, lines_json, created_at
     FROM purchase_invoices WHERE id = $1 LIMIT 1`,
    [referenceId],
  );
  if (!res.rows.length) return null;
  const inv = res.rows[0];
  let items = [];
  try {
    const parsed = JSON.parse(inv.lines_json || '[]');
    if (Array.isArray(parsed)) {
      items = parsed.map((line) => mapLineItem({
        product_name: line.productName || line.product_name || line.description,
        sku: line.sku || line.productSku,
        quantity: line.quantity,
        unit_price: line.unitPrice ?? line.unit_price ?? line.price,
        subtotal: line.subtotal ?? line.total,
      }));
    }
  } catch {
    items = [];
  }
  return {
    documentType: 'purchase_invoice',
    documentNumber: inv.invoice_number,
    documentDate: inv.date || inv.created_at,
    supplierName: inv.supplier_name,
    supplierNif: inv.supplier_nif,
    warehouseName: inv.warehouse_name,
    total: Number(inv.total) || 0,
    branchName: inv.branch_name,
    items,
    itemsSummary: summarizeItems(items),
  };
}

async function loadPurchaseOrderContext(db, referenceId) {
  const res = await db.query(
    `SELECT po.order_number, po.supplier_name, po.total, po.created_at,
            b.name AS branch_name
     FROM purchase_orders po
     LEFT JOIN branches b ON po.branch_id = b.id
     WHERE po.id = $1 LIMIT 1`,
    [referenceId],
  );
  if (!res.rows.length) return null;
  const order = res.rows[0];
  const itemsRes = await db.query(
    `SELECT product_name, sku, quantity, unit_price, subtotal
     FROM purchase_order_items WHERE order_id = $1`,
    [referenceId],
  );
  const items = itemsRes.rows.map(mapLineItem);
  return {
    documentType: 'purchase',
    documentNumber: order.order_number,
    documentDate: order.created_at,
    supplierName: order.supplier_name,
    total: Number(order.total) || 0,
    branchName: order.branch_name,
    items,
    itemsSummary: summarizeItems(items),
  };
}

async function loadTransferContext(db, referenceId) {
  const res = await db.query(
    `SELECT st.transfer_number, st.status, st.created_at,
            fb.name AS from_branch_name, tb.name AS to_branch_name
     FROM stock_transfers st
     LEFT JOIN branches fb ON st.from_branch_id = fb.id
     LEFT JOIN branches tb ON st.to_branch_id = tb.id
     WHERE st.id = $1 LIMIT 1`,
    [referenceId],
  );
  if (!res.rows.length) return null;
  const tr = res.rows[0];
  return {
    documentType: 'transfer',
    documentNumber: tr.transfer_number,
    documentDate: tr.created_at,
    status: tr.status,
    fromBranchName: tr.from_branch_name,
    toBranchName: tr.to_branch_name,
    relatedDocument: tr.from_branch_name && tr.to_branch_name
      ? { type: 'transfer', number: `${tr.from_branch_name} → ${tr.to_branch_name}` }
      : null,
  };
}

async function loadAdjustmentContext(db, referenceId) {
  const res = await db.query(
    `SELECT sm.reference_number, sm.movement_type, sm.notes, sm.created_at,
            p.name AS product_name, p.sku,
            SUM(ABS(sm.quantity)) AS total_qty,
            COUNT(*) AS line_count
     FROM stock_movements sm
     LEFT JOIN products p ON sm.product_id = p.id
     WHERE sm.reference_id = $1
     GROUP BY sm.reference_number, sm.movement_type, sm.notes, sm.created_at, p.name, p.sku
     ORDER BY sm.created_at
     LIMIT 20`,
    [referenceId],
  );
  if (!res.rows.length) {
    const fallback = await db.query(
      `SELECT reference_number, movement_type, notes, created_at
       FROM stock_movements WHERE reference_id = $1 LIMIT 1`,
      [referenceId],
    );
    if (!fallback.rows.length) return null;
    const row = fallback.rows[0];
    return {
      documentType: 'adjustment',
      documentNumber: row.reference_number,
      documentDate: row.created_at,
      direction: String(row.movement_type || '').toUpperCase(),
      notes: row.notes,
    };
  }
  const first = res.rows[0];
  const items = res.rows
    .filter((r) => r.product_name)
    .map((r) => ({
      name: r.product_name,
      sku: r.sku || '',
      quantity: Number(r.total_qty) || 0,
    }));
  return {
    documentType: 'adjustment',
    documentNumber: first.reference_number,
    documentDate: first.created_at,
    direction: String(first.movement_type || '').toUpperCase(),
    notes: first.notes,
    items,
    itemsSummary: summarizeItems(items),
  };
}

async function loadExpenseContext(db, referenceId) {
  try {
    const res = await db.query(
      `SELECT id, expense_number, description, category, total_amount, amount,
              payment_source, payee_name, status, branch_name, paid_at, created_at
       FROM expenses WHERE id = $1 LIMIT 1`,
      [referenceId],
    );
    if (!res.rows.length) return null;
    const e = res.rows[0];
    return {
      documentType: 'expense',
      documentNumber: e.expense_number || e.id,
      documentDate: e.paid_at || e.created_at,
      entityName: e.payee_name || e.description,
      notes: e.description,
      paymentMethod: e.payment_source,
      total: Number(e.total_amount ?? e.amount) || 0,
      branchName: e.branch_name,
      itemsSummary: e.category ? String(e.category) : null,
    };
  } catch {
    return null;
  }
}

async function enrichJournalEntryContext(db, entry) {
  const referenceId = entry.reference_id || entry.referenceId;
  const referenceType = String(entry.reference_type || entry.referenceType || '').toLowerCase();
  if (!referenceId) return null;

  try {
    switch (referenceType) {
      case 'sale':
      case 'venda':
        return await loadSaleContext(db, referenceId);
      case 'credit_note':
        return await loadCreditNoteContext(db, referenceId);
      case 'debit_note':
        return await loadDebitNoteContext(db, referenceId);
      case 'receipt':
      case 'payment':
      case 'payment_receipt':
      case 'payment_out':
      case 'pagamento':
      case 'recibo':
        return await loadPaymentContext(db, referenceId);
      case 'purchase_invoice':
      case 'compra':
        return await loadPurchaseInvoiceContext(db, referenceId);
      case 'purchase':
        return (await loadPurchaseInvoiceContext(db, referenceId))
          || (await loadPurchaseOrderContext(db, referenceId));
      case 'transfer':
        return await loadTransferContext(db, referenceId);
      case 'adjustment':
      case 'ajuste':
        return await loadAdjustmentContext(db, referenceId);
      case 'expense':
      case 'despesa':
        return await loadExpenseContext(db, referenceId);
      default:
        return null;
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT]', referenceType, referenceId, err.message);
    return null;
  }
}

function collectReferenceIds(entries, types) {
  const ids = [];
  const seen = new Set();
  const typeSet = new Set(types);
  for (const entry of entries) {
    const t = String(entry.reference_type || entry.referenceType || '').toLowerCase();
    const id = entry.reference_id || entry.referenceId;
    if (!id || !typeSet.has(t)) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(key);
  }
  return ids;
}

async function fetchRowsByIds(db, sql, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const result = await db.query(sql.replace(/__IN__/g, placeholders), ids);
  return result.rows || [];
}

/**
 * Batch header context for journal lists (no line-item queries).
 * Full per-entry context with items stays on GET /:id.
 */
async function enrichJournalEntriesLight(db, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  const ctxByRef = new Map();

  const put = (id, ctx, types) => {
    if (!id || !ctx) return;
    const keyId = String(id);
    for (const t of types) ctxByRef.set(`${t}:${keyId}`, ctx);
  };

  try {
    const saleIds = collectReferenceIds(entries, ['sale', 'venda']);
    const sales = await fetchRowsByIds(db, `
      SELECT s.id, s.invoice_number, s.payment_method,
             COALESCE(NULLIF(TRIM(s.customer_name), ''), NULLIF(TRIM(c.name), '')) AS customer_name,
             COALESCE(NULLIF(TRIM(s.customer_nif), ''), NULLIF(TRIM(c.nif), '')) AS customer_nif,
             s.invoice_type, s.total, s.created_at, b.name AS branch_name
      FROM sales s
      LEFT JOIN branches b ON s.branch_id = b.id
      LEFT JOIN clients c ON s.client_id = c.id
      WHERE CAST(s.id AS TEXT) IN (__IN__)
    `, saleIds);
    for (const sale of sales) {
      put(sale.id, {
        documentType: 'sale',
        documentNumber: sale.invoice_number,
        documentDate: sale.created_at,
        paymentMethod: sale.payment_method,
        customerName: sale.customer_name,
        customerNif: sale.customer_nif,
        invoiceType: sale.invoice_type,
        total: Number(sale.total) || 0,
        branchName: sale.branch_name,
      }, ['sale', 'venda']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] sales batch:', err.message);
  }

  try {
    const noteIds = collectReferenceIds(entries, ['credit_note']);
    const notes = await fetchRowsByIds(db, `
      SELECT id, document_number, original_invoice_number, customer_name, reason,
             reason_description, total, branch_name, issued_at
      FROM credit_notes WHERE CAST(id AS TEXT) IN (__IN__)
    `, noteIds);
    for (const note of notes) {
      put(note.id, {
        branchName: note.branch_name,
      }, ['credit_note']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] credit notes batch:', err.message);
  }

  try {
    const noteIds = collectReferenceIds(entries, ['debit_note']);
    const notes = await fetchRowsByIds(db, `
      SELECT id, document_number, original_invoice_number, customer_name, reason,
             reason_description, total, branch_name, issued_at
      FROM debit_notes WHERE CAST(id AS TEXT) IN (__IN__)
    `, noteIds);
    for (const note of notes) {
      put(note.id, {
        branchName: note.branch_name,
      }, ['debit_note']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] debit notes batch:', err.message);
  }

  try {
    const payIds = collectReferenceIds(entries, [
      'receipt', 'payment', 'payment_receipt', 'payment_out', 'pagamento', 'recibo',
    ]);
    const pays = await fetchRowsByIds(db, `
      SELECT p.id, p.payment_number, p.payment_type, p.entity_type, p.entity_id,
             COALESCE(
               NULLIF(TRIM(p.entity_name), ''),
               CASE
                 WHEN p.entity_type = 'supplier' THEN s.name
                 WHEN p.entity_type = 'customer' THEN c.name
                 ELSE NULL
               END
             ) AS entity_name,
             p.payment_method, p.amount, p.reference, p.notes, p.created_at, p.posted_at,
             b.name AS branch_name
      FROM payments p
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN suppliers s ON p.entity_type = 'supplier' AND s.id = p.entity_id
      LEFT JOIN clients c ON p.entity_type = 'customer' AND c.id = p.entity_id
      WHERE CAST(p.id AS TEXT) IN (__IN__)
    `, payIds);
    for (const p of pays) {
      const entityType = String(p.entity_type || '').toLowerCase();
      const entityName = String(p.entity_name || '').trim();
      put(p.id, {
        documentType: p.payment_type === 'receipt' ? 'payment_receipt' : 'payment_out',
        documentNumber: p.payment_number,
        documentDate: p.posted_at || p.created_at,
        entityType,
        entityName,
        supplierName: entityType === 'supplier' ? entityName : undefined,
        customerName: entityType === 'customer' ? entityName : undefined,
        paymentMethod: p.payment_method,
        total: Number(p.amount) || 0,
        reference: p.reference,
        notes: p.notes,
        branchName: p.branch_name,
      }, ['receipt', 'payment', 'payment_receipt', 'payment_out', 'pagamento', 'recibo']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] payments batch:', err.message);
  }

  try {
    const invIds = collectReferenceIds(entries, ['purchase_invoice', 'compra', 'purchase']);
    const invoices = await fetchRowsByIds(db, `
      SELECT id, invoice_number, supplier_name, supplier_nif, date, total,
             warehouse_name, branch_name, created_at
      FROM purchase_invoices WHERE CAST(id AS TEXT) IN (__IN__)
    `, invIds);
    for (const inv of invoices) {
      put(inv.id, {
        documentType: 'purchase_invoice',
        documentNumber: inv.invoice_number,
        documentDate: inv.date || inv.created_at,
        supplierName: inv.supplier_name,
        supplierNif: inv.supplier_nif,
        warehouseName: inv.warehouse_name,
        total: Number(inv.total) || 0,
        branchName: inv.branch_name,
      }, ['purchase_invoice', 'compra', 'purchase']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] purchase invoices batch:', err.message);
  }

  try {
    const trIds = collectReferenceIds(entries, ['transfer']);
    const transfers = await fetchRowsByIds(db, `
      SELECT st.id, st.transfer_number, st.status, st.created_at,
             fb.name AS from_branch_name, tb.name AS to_branch_name
      FROM stock_transfers st
      LEFT JOIN branches fb ON st.from_branch_id = fb.id
      LEFT JOIN branches tb ON st.to_branch_id = tb.id
      WHERE CAST(st.id AS TEXT) IN (__IN__)
    `, trIds);
    for (const tr of transfers) {
      put(tr.id, {
        documentType: 'transfer',
        documentNumber: tr.transfer_number,
        documentDate: tr.created_at,
        status: tr.status,
        fromBranchName: tr.from_branch_name,
        toBranchName: tr.to_branch_name,
        relatedDocument: tr.from_branch_name && tr.to_branch_name
          ? { type: 'transfer', number: `${tr.from_branch_name} → ${tr.to_branch_name}` }
          : null,
      }, ['transfer']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] transfers batch:', err.message);
  }

  try {
    const expIds = collectReferenceIds(entries, ['expense', 'despesa']);
    const expenses = await fetchRowsByIds(db, `
      SELECT id, expense_number, description, category, total_amount, amount,
             payment_source, payee_name, branch_name, paid_at, created_at
      FROM expenses WHERE CAST(id AS TEXT) IN (__IN__)
    `, expIds);
    for (const e of expenses) {
      put(e.id, {
        documentType: 'expense',
        documentNumber: e.expense_number || e.id,
        documentDate: e.paid_at || e.created_at,
        entityName: e.payee_name || e.description,
        notes: e.description,
        paymentMethod: e.payment_source,
        total: Number(e.total_amount ?? e.amount) || 0,
        branchName: e.branch_name,
        itemsSummary: e.category ? String(e.category) : null,
      }, ['expense', 'despesa']);
    }
  } catch (err) {
    console.warn('[JOURNAL CONTEXT] expenses batch:', err.message);
  }

  for (const entry of entries) {
    const id = entry.reference_id || entry.referenceId;
    const type = String(entry.reference_type || entry.referenceType || '').toLowerCase();
    if (id) {
      entry.context = ctxByRef.get(`${type}:${String(id)}`) || null;
    }
  }
  return entries;
}

async function enrichJournalEntries(db, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  if (entries.length === 1) {
    entries[0].context = await enrichJournalEntryContext(db, entries[0]);
    return entries;
  }
  return enrichJournalEntriesLight(db, entries);
}

module.exports = {
  enrichJournalEntryContext,
  enrichJournalEntries,
  enrichJournalEntriesLight,
  summarizeItems,
};
