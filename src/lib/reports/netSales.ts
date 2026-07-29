import type { CreditNote, Sale, SaleItem } from '@/types/erp';

export type ReportSalesFilter = {
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
  /** When false (default), voided sales are excluded. */
  includeVoided?: boolean;
};

function localDate(raw?: string): string {
  return raw ? String(raw).slice(0, 10) : '';
}

/** Map issued credit notes to Sale-shaped rows with negated amounts for netting in reports. */
export function creditNotesToNegativeSales(notes: CreditNote[]): Sale[] {
  return (notes || [])
    .filter((n) => n && String(n.status || '').toLowerCase() !== 'cancelled' && String(n.status || '').toLowerCase() !== 'draft')
    .map((n) => {
      const items: SaleItem[] = (n.items || []).map((item) => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: -Math.abs(Number(item.quantity) || 0),
        unitPrice: Number(item.unitPrice) || 0,
        discount: 0,
        taxRate: Number(item.taxRate) || 0,
        taxAmount: -Math.abs(Number(item.taxAmount) || 0),
        subtotal: -Math.abs(Number(item.subtotal) || 0),
      }));
      const createdAt = n.issuedAt || n.createdAt || '';
      return {
        id: `cn:${n.id}`,
        invoiceNumber: n.documentNumber || n.id,
        branchId: n.branchId,
        cashierId: n.issuedBy || '',
        cashierName: n.issuedBy,
        items,
        subtotal: -Math.abs(Number(n.subtotal) || 0),
        taxAmount: -Math.abs(Number(n.taxAmount) || 0),
        discount: 0,
        total: -Math.abs(Number(n.total) || 0),
        paymentMethod: (n.originalPaymentMethod as Sale['paymentMethod']) || 'cash',
        amountPaid: 0,
        change: 0,
        customerNif: n.customerNif,
        customerName: n.customerName,
        status: 'completed',
        createdAt,
      } satisfies Sale;
    });
}

/** Filter sales for report windows; skips voided unless includeVoided is true. */
export function filterReportSales(
  sales: Sale[],
  { dateFrom, dateTo, branchId, includeVoided = false }: ReportSalesFilter,
): Sale[] {
  const from = String(dateFrom || '').slice(0, 10);
  const to = String(dateTo || '').slice(0, 10);
  const branch = branchId && branchId !== 'all' ? String(branchId) : undefined;

  return (sales || []).filter((sale) => {
    if (!includeVoided) {
      if (sale.status === 'voided') return false;
      if (sale.status !== 'completed') return false;
    }
    const d = localDate(sale.createdAt);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (branch && sale.branchId !== branch) return false;
    return true;
  });
}

/** Merge sales + credit-note negatives, then apply the report window filter. */
export function mergeNetReportSales(
  sales: Sale[],
  creditNotes: CreditNote[],
  filter: ReportSalesFilter,
): Sale[] {
  const negatives = creditNotesToNegativeSales(creditNotes);
  return filterReportSales([...(sales || []), ...negatives], filter);
}
