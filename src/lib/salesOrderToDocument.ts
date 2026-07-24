import { ERPDocument, DocumentLine } from '@/types/documents';
import { calculateDocumentTotals, calculateLineTotals } from '@/lib/documentStorage';

export interface SalesOrderItem {
  id?: string;
  productId?: string;
  productName?: string;
  sku?: string;
  description?: string;
  quantity: number;
  reservedQty?: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  branchId?: string;
  branchName?: string;
  warehouseId?: string;
  customerName: string;
  customerNif?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  clientId?: string;
  items: SalesOrderItem[];
  subtotal: number;
  taxAmount: number;
  discount?: number;
  total: number;
  currency?: string;
  status: string;
  notes?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Map a sales order into an ERP document prefill for sales invoice creation. */
export function salesOrderToErpDocumentPrefill(order: SalesOrder): ERPDocument {
  const lines: DocumentLine[] = order.items.map((item, index) =>
    calculateLineTotals({
      id: item.id || `line_${index}`,
      productId: item.productId,
      productSku: item.sku,
      description: item.productName || item.description || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount || 0,
      taxRate: item.taxRate ?? 14,
    }),
  );

  const totals = calculateDocumentTotals(lines);
  const issueDate = order.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0];

  return {
    id: order.id,
    documentType: 'sales_order',
    documentNumber: order.orderNumber,
    branchId: order.branchId,
    branchName: order.branchName,
    entityType: 'customer',
    entityId: order.clientId,
    entityName: order.customerName,
    entityNif: order.customerNif,
    entityAddress: order.customerAddress,
    entityPhone: order.customerPhone,
    entityEmail: order.customerEmail,
    lines,
    subtotal: totals.subtotal,
    totalDiscount: totals.totalDiscount,
    totalTax: totals.totalTax,
    total: totals.total,
    currency: order.currency || 'AOA',
    amountPaid: 0,
    amountDue: totals.total,
    status: 'draft',
    issueDate,
    issueTime: '00:00:00',
    notes: order.notes,
    createdBy: order.createdBy,
    createdByName: order.createdByName,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
