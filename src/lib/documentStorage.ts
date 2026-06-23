// Document storage — DUAL-MODE: Electron → SQLite | Web → localStorage
import {
  ERPDocument,
  DocumentType,
  DocumentStatus,
  DocumentLine,
  generateDocumentNumber,
  DOCUMENT_TYPE_CONFIG,
  normalizeErpDocumentType,
} from '@/types/documents';
import { isElectronMode, dbGetAll, dbInsert, lsGet, lsSet } from '@/lib/dbHelper';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import * as storage from '@/lib/storage';
import { branchIdsEqual } from '@/lib/branchAccess';
import {
  getPurchaseInvoices,
  scopeBelongsToBranch,
  type BranchRef,
  type PurchaseInvoice,
} from '@/lib/purchaseInvoiceStorage';
import type { CreditNote } from '@/types/erp';
import { isFiscallyImmutable, allowsDueDateOnlyEdit } from '@/lib/fiscalImmutability';

const STORAGE_KEY = 'kwanzaerp_documents';

function mapSaleRowToDocument(sale: any, branchName = ''): ERPDocument {
  const createdAt = sale.createdAt || sale.created_at || new Date().toISOString();
  const issueDate = String(createdAt).split('T')[0] || createdAt;
  const items = Array.isArray(sale.items) ? sale.items : [];
  const lines: DocumentLine[] = items.map((item: any, idx: number) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || item.unit_price || 0);
    const discountPct = Number(item.discount || 0);
    const taxAmount = Number(item.taxAmount || item.tax_amount || 0);
    // Stored line subtotal is the discounted (net, ex-VAT) amount; the unit price is the
    // original price, so the discount value is the difference between gross and net.
    const netExVat = Number(item.subtotal ?? item.total ?? quantity * unitPrice * (1 - discountPct / 100));
    const grossExVat = quantity * unitPrice;
    const discountAmount = Math.max(0, Math.round((grossExVat - netExVat) * 100) / 100);
    return {
      id: `line_${sale.id}_${idx}`,
      productId: item.productId || item.product_id,
      productSku: item.sku || '',
      description: item.productName || item.product_name || '',
      quantity,
      unitPrice,
      discount: discountPct,
      discountAmount,
      taxRate: Number(item.taxRate || item.tax_rate || 0),
      taxAmount,
      lineTotal: Math.round((netExVat + taxAmount) * 100) / 100,
    };
  });

  const total = Number(sale.total || 0);
  const amountPaid = Number(sale.amountPaid || sale.amount_paid || 0);
  let status: DocumentStatus = 'confirmed';
  if (sale.status === 'voided') status = 'cancelled';
  else if (amountPaid >= total - 0.01) status = 'paid';
  else if (amountPaid > 0) status = 'partial';

  // ERPDocument convention: subtotal is the gross (pre-discount) goods value, with the
  // discount shown separately. Derive both from the lines so on-screen and printed
  // totals stay consistent (Mercadoria − Desconto + IVA = Total).
  const grossSubtotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100;
  const totalDiscount = Math.round(lines.reduce((s, l) => s + l.discountAmount, 0) * 100) / 100;

  return {
    id: sale.id,
    documentType: 'fatura_venda',
    documentNumber: sale.invoiceNumber || sale.invoice_number || '',
    branchId: sale.branchId || sale.branch_id || '',
    branchName,
    entityType: 'customer',
    entityName: sale.customerName || sale.customer_name || 'Consumidor Final',
    entityNif: sale.customerNif || sale.customer_nif,
    lines,
    subtotal: grossSubtotal,
    totalDiscount,
    totalTax: Number(sale.taxAmount || sale.tax_amount || 0),
    total,
    currency: 'AOA',
    paymentMethod: sale.paymentMethod || sale.payment_method || 'cash',
    amountPaid,
    amountDue: Math.max(0, total - amountPaid),
    status,
    issueDate,
    issueTime: String(createdAt).includes('T')
      ? String(createdAt).split('T')[1]?.substring(0, 8) || ''
      : '',
    dueDate: sale.dueDate || sale.due_date || undefined,
    createdBy: sale.cashierId || sale.cashier_id || '',
    createdByName: sale.cashierName || sale.cashier_name || '',
    createdAt,
    updatedAt: createdAt,
    fiscalLocked: String(sale.fiscalStatus || sale.fiscal_status || 'issued') !== 'draft',
    agtStatus: sale.agtStatus || sale.agt_status || undefined,
    agtCode: sale.agtCode || sale.agt_code || undefined,
  };
}

function mapPurchaseInvoiceToDocument(inv: PurchaseInvoice, branchName = ''): ERPDocument {
  const lines: DocumentLine[] = (inv.lines || []).map((line, idx) => {
    const gross = line.quantity * line.unitPrice;
    const discountAmount = gross * ((line.discountPct || 0) / 100);
    const afterDiscount = gross - discountAmount;
    const taxAmount = afterDiscount * ((line.taxRate || 0) / 100);
    return {
      id: line.id || `line_${inv.id}_${idx}`,
      productId: line.productId,
      productSku: line.productCode || '',
      description: line.description || '',
      quantity: Number(line.quantity || 0),
      unitPrice: Number(line.unitPrice || 0),
      discount: Number(line.discountPct || 0),
      discountAmount,
      taxRate: Number(line.taxRate || 0),
      taxAmount,
      lineTotal: afterDiscount + taxAmount,
    };
  });

  let status: DocumentStatus = 'draft';
  const raw = String(inv.status || '').toLowerCase();
  if (raw === 'cancelled' || raw === 'voided') status = 'cancelled';
  else if (raw === 'posted' || raw === 'confirmed') status = 'confirmed';

  const branchId = inv.branchId || inv.warehouseId || '';
  return {
    id: inv.id,
    documentType: 'fatura_compra',
    documentNumber: inv.invoiceNumber || '',
    branchId,
    branchName: inv.branchName || inv.warehouseName || branchName,
    entityType: 'supplier',
    entityName: inv.supplierName || '',
    entityNif: inv.supplierNif,
    lines,
    subtotal: Number(inv.subtotal || 0),
    totalDiscount: 0,
    totalTax: Number(inv.ivaTotal || 0),
    total: Number(inv.total || 0),
    currency: inv.currency || 'AOA',
    amountPaid: 0,
    amountDue: Number(inv.total || 0),
    status,
    issueDate: inv.date || String(inv.createdAt || '').split('T')[0] || '',
    createdBy: inv.createdBy || '',
    createdByName: inv.createdByName || '',
    createdAt: inv.createdAt || '',
    updatedAt: inv.updatedAt || inv.createdAt || '',
  };
}

/** Fiscal credit notes (`credit_notes` table) — canonical source for nota_credito. */
export function mapCreditNoteToDocument(
  cn: CreditNote,
  branchName = '',
  finalConsumerLabel = 'Consumidor Final',
): ERPDocument {
  const issuedAt = cn.issuedAt || cn.createdAt || new Date().toISOString();
  const issueDate = String(issuedAt).includes('T')
    ? String(issuedAt).split('T')[0]
    : String(issuedAt).slice(0, 10);
  return {
    id: cn.id,
    documentType: 'nota_credito',
    documentNumber: cn.documentNumber,
    branchId: cn.branchId || '',
    branchName: branchName || cn.branchName || '',
    entityType: 'customer',
    entityName: cn.customerName || finalConsumerLabel,
    entityNif: cn.customerNif,
    lines: cn.items.map((item, idx) => ({
      id: `cn_${cn.id}_${idx}`,
      productId: item.productId || '',
      productSku: item.sku,
      description: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: 0,
      discountAmount: 0,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      lineTotal: item.subtotal + item.taxAmount,
    })),
    subtotal: cn.subtotal,
    totalDiscount: 0,
    totalTax: cn.taxAmount,
    total: cn.total,
    currency: 'AOA',
    amountPaid: 0,
    amountDue: cn.total,
    parentDocumentNumber: cn.originalInvoiceNumber,
    status: cn.status === 'cancelled' ? 'cancelled' : 'confirmed',
    issueDate,
    issueTime: new Date(issuedAt).toLocaleTimeString('pt-AO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    fiscalLocked: true,
    agtStatus: cn.agtStatus as ERPDocument['agtStatus'],
    agtCode: cn.agtCode,
    createdBy: cn.issuedBy || '',
    createdAt: cn.createdAt,
    updatedAt: cn.createdAt,
  };
}

/** Purchase invoices (FC) from API / SQLite — not stored in erp_documents. */
export async function getPurchaseInvoicesAsDocuments(
  branchId?: string,
  branchNames: Record<string, string> = {},
  branchCatalog: BranchRef[] = [],
  includeAllBranches = false,
): Promise<ERPDocument[]> {
  const invoices = await getPurchaseInvoices(
    includeAllBranches ? undefined : branchId,
    branchCatalog,
  );
  return invoices
    .map((inv) => {
      const bid = inv.branchId || inv.warehouseId || '';
      return mapPurchaseInvoiceToDocument(inv, branchNames[bid] || inv.branchName || '');
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Sales invoices from POS / transaction engine (`sales` table) — canonical in production. */
export async function getSalesInvoicesAsDocuments(
  branchId?: string,
  branchNames: Record<string, string> = {},
  includeAllBranches = false,
  branchCatalog: BranchRef[] = [],
): Promise<ERPDocument[]> {
  let rows: any[] = [];

  if (isDemoMode()) {
    rows = await storage.getSales(includeAllBranches ? undefined : branchId);
  } else {
    const res = await api.sales.list(includeAllBranches ? undefined : branchId);
    if (res.error) {
      throw new Error(res.error);
    }
    if (!Array.isArray(res.data)) {
      console.warn('[Documents] sales API returned non-array payload');
      return [];
    }
    rows = res.data;
    if (branchId && !includeAllBranches) {
      rows = rows.filter((s) =>
        scopeBelongsToBranch(
          [s.branch_id, s.branchId, s.warehouse_id, s.warehouseId],
          branchId,
          branchCatalog,
        ),
      );
    }
  }

  return rows
    .map((sale) => {
      const bid = sale.branchId || sale.branch_id || '';
      return mapSaleRowToDocument(sale, branchNames[bid] || '');
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getDocuments(type?: DocumentType, branchId?: string): Promise<ERPDocument[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('erp_documents');
    const dbDocs = rows.map(mapDocFromDb);
    const localDocs = lsGet<ERPDocument[]>(STORAGE_KEY, []);
    const byId = new Map<string, ERPDocument>();
    for (const doc of [...localDocs, ...dbDocs]) {
      byId.set(doc.id, normalizeSupplierPurchaseReturnDocument(doc));
    }
    let docs = Array.from(byId.values());
    if (type) docs = docs.filter(d => d.documentType === type);
    if (branchId) docs = docs.filter(d => branchIdsEqual(d.branchId, branchId));
    return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  let docs = lsGet<ERPDocument[]>(STORAGE_KEY, []).map(normalizeSupplierPurchaseReturnDocument);
  if (type) docs = docs.filter(d => d.documentType === type);
  if (branchId) docs = docs.filter(d => branchIdsEqual(d.branchId, branchId));
  return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getDocumentById(id: string): Promise<ERPDocument | undefined> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('erp_documents');
    const row = rows.find((r: any) => r.id === id);
    if (row) return mapDocFromDb(row);
    return lsGet<ERPDocument[]>(STORAGE_KEY, []).find(d => d.id === id);
  }
  return lsGet<ERPDocument[]>(STORAGE_KEY, []).find(d => d.id === id);
}

export async function getNextSequence(type: DocumentType, branchId: string): Promise<number> {
  const docs = await getDocuments(type, branchId);
  return docs.length + 1;
}

function assertDocumentMayBeSaved(existing: ERPDocument | undefined, doc: ERPDocument): ERPDocument {
  if (!existing || !isFiscallyImmutable(existing)) {
    return { ...doc, updatedAt: new Date().toISOString() };
  }
  if (allowsDueDateOnlyEdit(existing) && doc.dueDate !== existing.dueDate) {
    return { ...existing, dueDate: doc.dueDate, updatedAt: new Date().toISOString() };
  }
  throw new Error('FISCAL_IMMUTABLE');
}

export async function saveDocument(doc: ERPDocument): Promise<ERPDocument> {
  const existing = await getDocumentById(doc.id);
  const nextDoc = assertDocumentMayBeSaved(existing, doc);

  if (isElectronMode()) {
    const saved = await dbInsert('erp_documents', mapDocToDb(nextDoc));
    if (saved) {
      return nextDoc;
    }
    const docs = lsGet<ERPDocument[]>(STORAGE_KEY, []);
    const idx = docs.findIndex(d => d.id === nextDoc.id);
    if (idx >= 0) docs[idx] = nextDoc;
    else docs.push(nextDoc);
    lsSet(STORAGE_KEY, docs);
    return nextDoc;
  }
  const docs = lsGet<ERPDocument[]>(STORAGE_KEY, []);
  const idx = docs.findIndex(d => d.id === nextDoc.id);
  if (idx >= 0) {
    docs[idx] = nextDoc;
  } else {
    docs.push(nextDoc);
  }
  lsSet(STORAGE_KEY, docs);
  return nextDoc;
}

export async function createDocument(
  type: DocumentType,
  branchId: string,
  branchCode: string,
  branchName: string,
  createdBy: string,
  createdByName: string,
  data: Partial<ERPDocument>
): Promise<ERPDocument> {
  if (type === 'nota_credito') {
    throw new Error('Credit notes must be issued in Fiscal Documents (stock and AGT compliance).');
  }
  const seq = await getNextSequence(type, branchId);
  const now = new Date().toISOString();
  
  const doc: ERPDocument = {
    id: data.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    documentType: type,
    documentNumber: data.documentNumber || generateDocumentNumber(type, branchCode, seq),
    branchId,
    branchName,
    entityType: DOCUMENT_TYPE_CONFIG[type].entityType,
    entityName: data.entityName || 'Consumidor Final',
    entityNif: data.entityNif,
    entityAddress: data.entityAddress,
    entityPhone: data.entityPhone,
    entityEmail: data.entityEmail,
    entityId: data.entityId,
    lines: data.lines || [],
    subtotal: data.subtotal || 0,
    totalDiscount: data.totalDiscount || 0,
    totalTax: data.totalTax || 0,
    total: data.total || 0,
    currency: 'AOA',
    paymentMethod: data.paymentMethod,
    amountPaid: data.amountPaid || 0,
    amountDue: data.amountDue || data.total || 0,
    parentDocumentId: data.parentDocumentId,
    parentDocumentNumber: data.parentDocumentNumber,
    parentDocumentType: data.parentDocumentType,
    status: data.status || 'draft',
    issueDate: data.issueDate || now,
    issueTime: data.issueTime || new Date().toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    dueDate: data.dueDate,
    validUntil: data.validUntil,
    notes: data.notes,
    internalNotes: data.internalNotes,
    termsAndConditions: data.termsAndConditions,
    createdBy,
    createdByName,
    createdAt: now,
    updatedAt: now,
    fiscalLocked:
      data.fiscalLocked === true
      || type === 'fatura_venda' && (data.status === 'confirmed' || data.status === 'paid')
      || (type === 'nota_credito' || type === 'nota_debito' || type === 'guia_remessa')
        && (data.status === 'confirmed' || data.status === 'paid'),
    agtStatus: data.agtStatus,
    agtCode: data.agtCode,
  };

  return saveDocument(doc);
}

export async function convertDocument(
  sourceId: string,
  targetType: DocumentType,
  branchCode: string,
  createdBy: string,
  createdByName: string
): Promise<ERPDocument | null> {
  const source = await getDocumentById(sourceId);
  if (!source) return null;

  const config = DOCUMENT_TYPE_CONFIG[source.documentType];
  if (!config.canConvertTo.includes(targetType)) return null;

  // Credit notes must go through the fiscal API (stock + accounting + hash chain).
  if (targetType === 'nota_credito' && source.documentType === 'fatura_venda') {
    return null;
  }

  const newDoc = await createDocument(
    targetType,
    source.branchId,
    branchCode,
    source.branchName,
    createdBy,
    createdByName,
    {
      entityName: source.entityName,
      entityNif: source.entityNif,
      entityAddress: source.entityAddress,
      entityPhone: source.entityPhone,
      entityEmail: source.entityEmail,
      entityId: source.entityId,
      lines: source.lines.map(l => ({ ...l, id: `line_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` })),
      subtotal: source.subtotal,
      totalDiscount: source.totalDiscount,
      totalTax: source.totalTax,
      total: source.total,
      parentDocumentId: source.id,
      parentDocumentNumber: source.documentNumber,
      parentDocumentType: source.documentType,
      status: 'confirmed',
    }
  );

  source.status = 'converted';
  source.childDocuments = [
    ...(source.childDocuments || []),
    { id: newDoc.id, number: newDoc.documentNumber, type: targetType }
  ];
  await saveDocument(source);

  return newDoc;
}

export function calculateLineTotals(line: Partial<DocumentLine>): DocumentLine {
  const qty = line.quantity || 0;
  const price = line.unitPrice || 0;
  const discPct = line.discount || 0;
  const taxRate = line.taxRate || 0;

  const gross = qty * price;
  const discountAmount = gross * (discPct / 100);
  const afterDiscount = gross - discountAmount;
  const taxAmount = afterDiscount * (taxRate / 100);
  const lineTotal = afterDiscount + taxAmount;

  return {
    id: line.id || `line_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    productId: line.productId,
    productSku: line.productSku,
    description: line.description || '',
    quantity: qty,
    unitPrice: price,
    discount: discPct,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxRate,
    taxAmount: Math.round(taxAmount * 100) / 100,
    lineTotal: Math.round(lineTotal * 100) / 100,
    accountCode: line.accountCode,
  };
}

export function calculateDocumentTotals(lines: DocumentLine[]) {
  const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice), 0);
  const totalDiscount = lines.reduce((s, l) => s + l.discountAmount, 0);
  const totalTax = lines.reduce((s, l) => s + l.taxAmount, 0);
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/** Purchase returns were briefly stored as supplier nota_debito with amountDue — fix on read. */
function normalizeSupplierPurchaseReturnDocument(doc: ERPDocument): ERPDocument {
  const isLegacyReturn =
    doc.documentType === 'nota_debito' &&
    (doc.entityType === 'supplier' || doc.parentDocumentType === 'fatura_compra');
  if (!isLegacyReturn) return doc;
  return {
    ...doc,
    documentType: 'nota_credito',
    entityType: 'supplier',
    amountDue: 0,
  };
}

// DB mappers
function safeParseJsonArray(raw: unknown): unknown[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapDocFromDb(row: any): ERPDocument {
  const entityType = row.entity_type === 'supplier' ? 'supplier' : 'customer';
  return normalizeSupplierPurchaseReturnDocument({
    id: row.id,
    documentType: normalizeErpDocumentType(
      row.document_type,
      entityType === 'supplier' ? 'fatura_compra' : 'fatura_venda',
    ),
    documentNumber: row.document_number || '',
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
    entityType: row.entity_type || 'customer',
    entityName: row.entity_name || '',
    entityNif: row.entity_nif,
    entityAddress: row.entity_address,
    entityPhone: row.entity_phone,
    entityEmail: row.entity_email,
    entityId: row.entity_id,
    lines: safeParseJsonArray(row.lines_json) as DocumentLine[],
    subtotal: Number(row.subtotal || 0),
    totalDiscount: Number(row.total_discount || 0),
    totalTax: Number(row.total_tax || 0),
    total: Number(row.total || 0),
    currency: row.currency || 'AOA',
    paymentMethod: row.payment_method,
    amountPaid: Number(row.amount_paid || 0),
    amountDue: Number(row.amount_due || 0),
    parentDocumentId: row.parent_document_id,
    parentDocumentNumber: row.parent_document_number,
    parentDocumentType: row.parent_document_type,
    status: row.status || 'draft',
    issueDate: row.issue_date || '',
    issueTime: row.issue_time || '',
    dueDate: row.due_date,
    validUntil: row.valid_until,
    notes: row.notes,
    internalNotes: row.internal_notes,
    termsAndConditions: row.terms_and_conditions,
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    childDocuments: row.child_documents_json
      ? (safeParseJsonArray(row.child_documents_json) as ERPDocument['childDocuments'])
      : undefined,
  });
}

function mapDocToDb(doc: ERPDocument): any {
  return {
    id: doc.id,
    document_type: doc.documentType,
    document_number: doc.documentNumber,
    branch_id: doc.branchId,
    branch_name: doc.branchName || '',
    entity_type: doc.entityType || '',
    entity_name: doc.entityName || '',
    entity_nif: doc.entityNif || '',
    entity_address: doc.entityAddress || '',
    entity_phone: doc.entityPhone || '',
    entity_email: doc.entityEmail || '',
    entity_id: doc.entityId || '',
    lines_json: JSON.stringify(doc.lines || []),
    subtotal: doc.subtotal,
    total_discount: doc.totalDiscount,
    total_tax: doc.totalTax,
    total: doc.total,
    currency: doc.currency || 'AOA',
    payment_method: doc.paymentMethod || '',
    amount_paid: doc.amountPaid || 0,
    amount_due: doc.amountDue || 0,
    parent_document_id: doc.parentDocumentId || '',
    parent_document_number: doc.parentDocumentNumber || '',
    parent_document_type: doc.parentDocumentType || '',
    status: doc.status,
    issue_date: doc.issueDate || '',
    issue_time: doc.issueTime || '',
    due_date: doc.dueDate || '',
    valid_until: doc.validUntil || '',
    notes: doc.notes || '',
    internal_notes: doc.internalNotes || '',
    terms_and_conditions: doc.termsAndConditions || '',
    created_by: doc.createdBy || '',
    created_by_name: doc.createdByName || '',
    child_documents_json: doc.childDocuments ? JSON.stringify(doc.childDocuments) : '',
    created_at: doc.createdAt || new Date().toISOString(),
    updated_at: doc.updatedAt || new Date().toISOString(),
  };
}
