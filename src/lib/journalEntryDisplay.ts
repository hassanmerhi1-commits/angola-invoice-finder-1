export interface JournalContextItem {
  name: string;
  sku?: string;
  quantity?: number;
  unitPrice?: number;
  subtotal?: number;
}

export interface JournalContext {
  documentType?: string;
  documentNumber?: string;
  documentDate?: string;
  paymentMethod?: string;
  customerName?: string;
  customerNif?: string;
  supplierName?: string;
  supplierNif?: string;
  entityName?: string;
  entityType?: string;
  invoiceType?: string;
  itemsSummary?: string;
  items?: JournalContextItem[];
  relatedDocument?: { type: string; number: string; id?: string };
  branchName?: string;
  warehouseName?: string;
  fromBranchName?: string;
  toBranchName?: string;
  direction?: string;
  notes?: string;
  reason?: string;
  reasonDescription?: string;
  reference?: string;
  total?: number;
  status?: string;
}

export interface JournalDisplayLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalDisplayEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  createdAt: string;
  postedAt?: string;
  type: string;
  displayType: string;
  referenceType: string;
  referenceId?: string;
  currency: string;
  description: string;
  readableTitle: string;
  readableSubtitle: string;
  customerName: string;
  contextSummary: string;
  totalDebit: number;
  totalCredit: number;
  isPosted: boolean;
  createdBy: string;
  branchName: string;
  context?: JournalContext | null;
  lines: JournalDisplayLine[];
}

export type JournalDisplayLabels = {
  systemUser: string;
  salesOfMerchandise: string;
  paymentCash: string;
  paymentCard: string;
  paymentTransfer: string;
  paymentCheque: string;
  paymentMixed: string;
  paymentCredit: string;
  paymentMobile: string;
  fieldInvoice: string;
  fieldCustomer: string;
  fieldSupplier: string;
  fieldPayment: string;
  fieldProducts: string;
  fieldBranch: string;
  fieldRelatedDoc: string;
  fieldDirectionIn: string;
  fieldDirectionOut: string;
  cogsEntry: string;
  walkInCustomer: string;
  descSale: string;
  descPurchase: string;
  descReceipt: string;
  descPayment: string;
  descAdjustment: string;
  descCreditNote: string;
  descDebitNote: string;
  descTransfer: string;
  fieldReason: string;
  fieldNotes: string;
  fieldReference: string;
  fieldDocTotal: string;
  fieldInvoiceType: string;
  fieldNif: string;
};

function parseContext(raw: unknown): JournalContext | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as JournalContext;
}

export function mapJournalLineFromApi(l: Record<string, unknown>, entryId: string): JournalDisplayLine {
  const debit = Number(l.debit_amount ?? l.debitAmount ?? l.debit ?? 0);
  const credit = Number(l.credit_amount ?? l.creditAmount ?? l.credit ?? 0);
  const accountCode = String(l.account_code ?? l.accountCode ?? '');
  return {
    id: String(l.id ?? `${entryId}_${accountCode}_${debit}_${credit}`),
    accountCode,
    accountName: String(l.account_name ?? l.accountName ?? ''),
    description: String(l.description ?? ''),
    debit,
    credit,
  };
}

export function formatPaymentMethod(method: string | undefined, labels: JournalDisplayLabels): string {
  const key = String(method || '').toLowerCase();
  const map: Record<string, string> = {
    cash: labels.paymentCash,
    card: labels.paymentCard,
    transfer: labels.paymentTransfer,
    cheque: labels.paymentCheque,
    check: labels.paymentCheque,
    mixed: labels.paymentMixed,
    credit: labels.paymentCredit,
    mobile: labels.paymentMobile,
  };
  return map[key] || method || '';
}

export function formatJournalDateTime(
  entry: Pick<JournalDisplayEntry, 'createdAt' | 'postedAt' | 'entryDate'>,
  locale: string,
): string {
  const ts = entry.postedAt || entry.createdAt || entry.entryDate;
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatJournalEntryDate(
  entry: Pick<JournalDisplayEntry, 'entryDate' | 'createdAt'>,
  locale: string,
): string {
  const ts = entry.entryDate || entry.createdAt;
  if (!ts) return '—';
  const d = new Date(ts.includes('T') ? ts : `${ts}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(locale);
}

export function isCogsJournalDescription(description: string): boolean {
  return /cmv|custo mercadorias|cogs/i.test(description);
}

export function resolveJournalDisplayType(referenceType: string, description: string): string {
  if (isCogsJournalDescription(description)) return 'cogs';
  const ref = String(referenceType || '').toLowerCase();
  if (ref === 'payment' || ref === 'pagamento') return 'payment_out';
  if (ref === 'receipt' || ref === 'recibo') return 'payment_receipt';
  return referenceType || 'manual';
}

function extractDocumentNumber(description: string, context: JournalContext | null): string {
  if (context?.documentNumber) return context.documentNumber;
  const patterns = [
    // Prefer full words — bare "pag"/"rec" wrongly match inside "Pagamento"/"Recebimento"
    /(?:pagamento|recebimento|payment|receipt)\s+([A-Z]{2,4}-[\w-]+)/i,
    /\b(?:venda|sale|cmv|nc|nd)\s*[-–]?\s*([A-Z]{0,3}-?[A-Z0-9][\w-]+)/i,
    /\b((?:PAG|REC|FS|FC|CP|VD|NC|ND)-[\w-]+)\b/i,
    /(FS-[A-Z0-9]+-\d{4}-\d+)/i,
    /(VD-\d{4}-\d+)/i,
  ];
  for (const re of patterns) {
    const m = description.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

export function resolveCustomerDisplay(
  context: JournalContext | null | undefined,
  labels: JournalDisplayLabels,
): string {
  const entityType = String(context?.entityType || '').toLowerCase();
  const supplierName = String(context?.supplierName || '').trim();
  const customerName = String(context?.customerName || '').trim();
  const entityName = String(context?.entityName || '').trim();

  if (entityType === 'supplier' || supplierName) {
    return supplierName || entityName || labels.fieldSupplier || 'Supplier';
  }
  const name = customerName || entityName || '';
  return name || labels.walkInCustomer;
}

function buildReadableText(
  referenceType: string,
  rawDescription: string,
  context: JournalContext | null,
  labels: JournalDisplayLabels,
  isCogs: boolean,
): { title: string; subtitle: string; customerName: string } {
  const customerName = resolveCustomerDisplay(context, labels);
  const docNo = extractDocumentNumber(rawDescription, context);
  const payment = context?.paymentMethod
    ? formatPaymentMethod(context.paymentMethod, labels)
    : '';
  const products = context?.itemsSummary || '';
  const ref = String(referenceType || '').toLowerCase();

  if (isCogs) {
    return {
      title: docNo ? `${labels.cogsEntry} — ${docNo}` : labels.cogsEntry,
      subtitle: [products, customerName !== labels.walkInCustomer ? customerName : ''].filter(Boolean).join(' · '),
      customerName,
    };
  }

  if (ref === 'sale' || ref === 'venda') {
    return {
      title: docNo ? `${labels.descSale} — ${docNo}` : labels.descSale,
      subtitle: [
        customerName !== labels.walkInCustomer ? customerName : '',
        payment,
        products,
      ].filter(Boolean).join(' · '),
      customerName,
    };
  }

  if (ref === 'purchase' || ref === 'purchase_invoice' || ref === 'compra') {
    const supplier = context?.supplierName || '';
    return {
      title: docNo ? `${labels.descPurchase} — ${docNo}` : labels.descPurchase,
      subtitle: [supplier, products, payment].filter(Boolean).join(' · '),
      customerName: supplier || customerName,
    };
  }

  if (ref === 'credit_note') {
    return {
      title: docNo ? `${labels.descCreditNote} — ${docNo}` : labels.descCreditNote,
      subtitle: [customerName !== labels.walkInCustomer ? customerName : '', products].filter(Boolean).join(' · '),
      customerName,
    };
  }

  if (ref === 'debit_note') {
    return {
      title: docNo ? `${labels.descDebitNote} — ${docNo}` : labels.descDebitNote,
      subtitle: [customerName !== labels.walkInCustomer ? customerName : '', products].filter(Boolean).join(' · '),
      customerName,
    };
  }

  if (ref === 'receipt' || ref === 'payment_receipt' || ref === 'recibo') {
    const entity = context?.entityName || context?.customerName || customerName;
    return {
      title: docNo ? `${labels.descReceipt} — ${docNo}` : labels.descReceipt,
      subtitle: [entity !== labels.walkInCustomer ? entity : '', payment].filter(Boolean).join(' · '),
      customerName: entity,
    };
  }

  if (ref === 'payment' || ref === 'payment_out' || ref === 'pagamento') {
    const entity = context?.supplierName || context?.entityName || customerName;
    return {
      title: docNo ? `${labels.descPayment} — ${docNo}` : labels.descPayment,
      subtitle: [entity !== labels.walkInCustomer ? entity : '', payment].filter(Boolean).join(' · '),
      customerName: entity,
    };
  }

  if (ref === 'adjustment' || ref === 'ajuste') {
    return {
      title: docNo ? `${labels.descAdjustment} — ${docNo}` : labels.descAdjustment,
      subtitle: [products, context?.direction === 'IN' ? labels.fieldDirectionIn : context?.direction === 'OUT' ? labels.fieldDirectionOut : ''].filter(Boolean).join(' · '),
      customerName,
    };
  }

  if (ref === 'transfer') {
    const route = context?.fromBranchName && context?.toBranchName
      ? `${context.fromBranchName} → ${context.toBranchName}`
      : '';
    return {
      title: docNo ? `${labels.descTransfer} — ${docNo}` : labels.descTransfer,
      subtitle: [route, products].filter(Boolean).join(' · '),
      customerName,
    };
  }

  return {
    title: rawDescription || labels.descAdjustment,
    subtitle: buildContextSummary(context, labels),
    customerName,
  };
}

function buildContextSummary(ctx: JournalContext | null | undefined, labels: JournalDisplayLabels): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.documentNumber) parts.push(ctx.documentNumber);
  if (ctx.customerName) parts.push(`${labels.fieldCustomer}: ${ctx.customerName}`);
  if (ctx.supplierName) parts.push(`${labels.fieldSupplier}: ${ctx.supplierName}`);
  if (ctx.entityName && !ctx.customerName && !ctx.supplierName) parts.push(ctx.entityName);
  if (ctx.itemsSummary) parts.push(ctx.itemsSummary);
  if (ctx.paymentMethod) {
    const pm = formatPaymentMethod(ctx.paymentMethod, labels);
    if (pm) parts.push(pm);
  }
  if (ctx.relatedDocument?.number) {
    parts.push(`${labels.fieldRelatedDoc}: ${ctx.relatedDocument.number}`);
  }
  if (ctx.direction === 'IN') parts.push(labels.fieldDirectionIn);
  if (ctx.direction === 'OUT') parts.push(labels.fieldDirectionOut);
  return parts.join(' · ');
}

export function mapJournalEntryFromApi(
  je: Record<string, unknown>,
  labels: JournalDisplayLabels,
): JournalDisplayEntry {
  const context = parseContext(je.context);
  const referenceType = String(je.reference_type ?? je.referenceType ?? 'manual');
  const rawDescription = String(je.description ?? '');
  const isCogs = isCogsJournalDescription(rawDescription);
  const displayType = resolveJournalDisplayType(referenceType, rawDescription);
  const readable = buildReadableText(referenceType, rawDescription, context, labels, isCogs);

  return {
    id: String(je.id),
    entryNumber: String(je.entry_number ?? je.entryNumber ?? ''),
    entryDate: String(je.entry_date ?? je.entryDate ?? ''),
    createdAt: String(je.created_at ?? je.createdAt ?? je.entry_date ?? ''),
    postedAt: je.posted_at ? String(je.posted_at) : je.postedAt ? String(je.postedAt) : undefined,
    type: displayType,
    displayType,
    referenceType,
    referenceId: je.reference_id ? String(je.reference_id) : je.referenceId ? String(je.referenceId) : undefined,
    currency: 'AOA',
    description: rawDescription,
    readableTitle: readable.title,
    readableSubtitle: readable.subtitle,
    customerName: readable.customerName,
    contextSummary: readable.subtitle || buildContextSummary(context, labels),
    totalDebit: Number(je.total_debit ?? je.totalDebit ?? 0),
    totalCredit: Number(je.total_credit ?? je.totalCredit ?? 0),
    isPosted: je.is_posted !== false && je.isPosted !== false,
    createdBy: String(je.created_by_name ?? je.createdByName ?? je.created_by ?? je.createdBy ?? labels.systemUser),
    branchName: String(
      je.branch_name ?? je.branchName ?? context?.branchName ?? '',
    ),
    context,
    lines: (Array.isArray(je.lines) ? je.lines : []).map((l) =>
      mapJournalLineFromApi(l as Record<string, unknown>, String(je.id)),
    ),
  };
}

export type JournalDetailRow = { label: string; value: string };

export function buildJournalDetailRows(
  entry: JournalDisplayEntry,
  labels: JournalDisplayLabels,
  locale: string,
): JournalDetailRow[] {
  const rows: JournalDetailRow[] = [];
  const ctx = entry.context;

  if (entry.branchName) rows.push({ label: labels.fieldBranch, value: entry.branchName });
  if (ctx?.documentNumber) rows.push({ label: labels.fieldInvoice, value: ctx.documentNumber });
  if (ctx?.invoiceType) rows.push({ label: labels.fieldInvoiceType, value: ctx.invoiceType });
  if (ctx?.customerName) rows.push({ label: labels.fieldCustomer, value: ctx.customerName });
  if (ctx?.customerNif) rows.push({ label: labels.fieldNif, value: ctx.customerNif });
  if (ctx?.supplierName) rows.push({ label: labels.fieldSupplier, value: ctx.supplierName });
  if (ctx?.entityName && !ctx.customerName && !ctx.supplierName) {
    const entityLabel = String(ctx.entityType || '').toLowerCase() === 'supplier'
      ? labels.fieldSupplier
      : labels.fieldCustomer;
    rows.push({ label: entityLabel, value: ctx.entityName });
  }
  if (ctx?.paymentMethod) {
    rows.push({ label: labels.fieldPayment, value: formatPaymentMethod(ctx.paymentMethod, labels) });
  }
  if (ctx?.warehouseName) rows.push({ label: labels.fieldBranch, value: ctx.warehouseName });
  if (ctx?.fromBranchName && ctx?.toBranchName) {
    rows.push({ label: labels.fieldBranch, value: `${ctx.fromBranchName} → ${ctx.toBranchName}` });
  }
  if (ctx?.relatedDocument?.number) {
    rows.push({ label: labels.fieldRelatedDoc, value: ctx.relatedDocument.number });
  }
  if (ctx?.itemsSummary) rows.push({ label: labels.fieldProducts, value: ctx.itemsSummary });
  if (ctx?.reason) rows.push({ label: labels.fieldReason, value: ctx.reason });
  if (ctx?.reasonDescription) rows.push({ label: labels.fieldNotes, value: ctx.reasonDescription });
  if (ctx?.notes) rows.push({ label: labels.fieldNotes, value: ctx.notes });
  if (ctx?.reference) rows.push({ label: labels.fieldReference, value: ctx.reference });
  if (ctx?.total != null && ctx.total > 0) {
    rows.push({ label: labels.fieldDocTotal, value: `${ctx.total.toLocaleString(locale)} Kz` });
  }

  return rows;
}
