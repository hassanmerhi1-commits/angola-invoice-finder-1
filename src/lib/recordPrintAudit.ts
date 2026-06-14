import { api } from '@/lib/api/client';
import type { DocumentType, ERPDocument } from '@/types/documents';

export type PrintFormat = 'thermal' | 'a4' | 'html';
export type PrintSource =
  | 'pos'
  | 'vendas'
  | 'invoices'
  | 'receipt_dialog'
  | 'invoice_view'
  | 'document_form'
  | 'purchase_invoice'
  | 'proforma';

export type RecordPrintOptions = {
  format?: PrintFormat;
  reprint?: boolean;
  source?: PrintSource;
};

const TABLE_BY_DOC_TYPE: Partial<Record<DocumentType, string>> = {
  proforma: 'proformas',
  fatura_venda: 'sales',
  fatura_compra: 'purchase_invoices',
  nota_credito: 'credit_notes',
  nota_debito: 'debit_notes',
  recibo: 'payments',
  guia_remessa: 'delivery_notes',
};

const DOC_LABEL_PT: Record<DocumentType, string> = {
  proforma: 'Orçamento',
  fatura_venda: 'Fatura',
  fatura_compra: 'Fatura de compra',
  recibo: 'Recibo',
  pagamento: 'Pagamento',
  nota_credito: 'Nota de Crédito',
  nota_debito: 'Nota de Débito',
  guia_remessa: 'Guia de Remessa',
};

/** Record a sales/POS invoice print in audit_log (and update printed_at). */
export async function recordSalePrint(
  sale: { id: string; invoiceNumber?: string | null },
  opts: RecordPrintOptions & { format: PrintFormat },
): Promise<void> {
  if (!sale?.id) return;
  try {
    await api.sales.markPrinted(sale.id, {
      format: opts.format,
      reprint: opts.reprint ?? false,
      source: opts.source,
      documentNumber: sale.invoiceNumber ?? undefined,
    });
  } catch (e) {
    console.warn('[recordSalePrint]', e);
  }
}

/** Record any ERP document print in audit_log. */
export async function recordDocumentPrint(
  doc: ERPDocument,
  opts: RecordPrintOptions = {},
): Promise<void> {
  if (!doc?.id) return;
  const format = opts.format ?? 'a4';

  if (doc.documentType === 'fatura_venda') {
    await recordSalePrint(
      { id: doc.id, invoiceNumber: doc.documentNumber },
      { ...opts, format },
    );
    return;
  }

  const tableName = TABLE_BY_DOC_TYPE[doc.documentType] || 'documents';
  const label = DOC_LABEL_PT[doc.documentType] || 'Documento';
  try {
    await api.audit.log({
      tableName,
      recordId: doc.id,
      action: 'print',
      description: `${label} ${doc.documentNumber} impresso`,
      metadata: {
        format,
        reprint: opts.reprint ?? false,
        source: opts.source,
        documentType: doc.documentType,
        documentNumber: doc.documentNumber,
      },
    });
  } catch (e) {
    console.warn('[recordDocumentPrint]', e);
  }
}

export async function recordPurchaseInvoicePrint(
  invoice: { id: string; invoiceNumber?: string | null },
  opts: RecordPrintOptions = {},
): Promise<void> {
  if (!invoice?.id) return;
  const format = opts.format ?? 'a4';
  try {
    await api.audit.log({
      tableName: 'purchase_invoices',
      recordId: invoice.id,
      action: 'print',
      description: `Fatura de compra ${invoice.invoiceNumber || invoice.id} impressa`,
      metadata: {
        format,
        reprint: opts.reprint ?? false,
        source: opts.source ?? 'purchase_invoice',
        documentNumber: invoice.invoiceNumber,
      },
    });
  } catch (e) {
    console.warn('[recordPurchaseInvoicePrint]', e);
  }
}

export async function recordProformaPrint(
  proforma: { id: string; documentNumber?: string | null },
  opts: RecordPrintOptions = {},
): Promise<void> {
  if (!proforma?.id) return;
  const format = opts.format ?? 'a4';
  try {
    await api.audit.log({
      tableName: 'proformas',
      recordId: proforma.id,
      action: 'print',
      description: `Orçamento ${proforma.documentNumber || proforma.id} impresso`,
      metadata: {
        format,
        reprint: opts.reprint ?? false,
        source: opts.source ?? 'proforma',
        documentNumber: proforma.documentNumber,
      },
    });
  } catch (e) {
    console.warn('[recordProformaPrint]', e);
  }
}
