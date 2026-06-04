import { ProForma } from '@/types/proforma';
import { ERPDocument, DocumentLine } from '@/types/documents';
import { calculateDocumentTotals, calculateLineTotals } from '@/lib/documentStorage';

/** Map a Pro Forma record into an ERP document prefill for sales invoice creation. */
export function proformaToErpDocumentPrefill(pf: ProForma): ERPDocument {
  const lines: DocumentLine[] = pf.items.map((item, index) =>
    calculateLineTotals({
      id: item.id || `line_${index}`,
      productId: item.productId,
      productSku: item.sku,
      description: item.productName || item.description || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount || 0,
      taxRate: item.taxRate,
    }),
  );

  const totals = calculateDocumentTotals(lines);
  const issueDate = pf.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0];

  return {
    id: pf.id,
    documentType: 'proforma',
    documentNumber: pf.documentNumber,
    branchId: pf.branchId,
    branchName: pf.branchName,
    entityType: 'customer',
    entityId: pf.clientId,
    entityName: pf.customerName,
    entityNif: pf.customerNif,
    entityAddress: pf.customerAddress,
    entityPhone: pf.customerPhone,
    entityEmail: pf.customerEmail,
    lines,
    subtotal: totals.subtotal,
    totalDiscount: totals.totalDiscount,
    totalTax: totals.totalTax,
    total: totals.total,
    currency: pf.currency || 'AOA',
    amountPaid: 0,
    amountDue: totals.total,
    status: 'draft',
    issueDate,
    issueTime: '00:00:00',
    validUntil: pf.validUntil,
    dueDate: pf.validUntil?.split('T')[0] || pf.validUntil,
    notes: pf.notes,
    createdBy: pf.createdBy,
    createdByName: pf.createdByName,
    createdAt: pf.createdAt,
    updatedAt: pf.updatedAt,
  };
}
