import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';
import type { DebitNote, DebitNoteItem, Sale } from '@/types/erp';

export type DebitLineDraft = DebitNoteItem & {
  sourceProductId?: string;
  soldQty?: number;
  originalUnitPrice?: number;
};

export type SaleDebitContext = {
  sale: Sale;
  priorDebitCount: number;
  priorDebitTotal: number;
  lines: Array<{
    item: Sale['items'][number];
    soldQty: number;
    originalUnitPrice: number;
  }>;
};

export function recalcDebitLine(item: DebitNoteItem): DebitNoteItem {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const taxRate = Number(item.taxRate) || 0;
  const subtotal = quantity * unitPrice;
  const taxAmount = subtotal * (taxRate / 100);
  return { ...item, quantity, unitPrice, taxRate, subtotal, taxAmount };
}

export function getDebitTotalsBySale(debitNotes: DebitNote[]): Map<string, { count: number; total: number }> {
  const map = new Map<string, { count: number; total: number }>();
  for (const note of debitNotes) {
    if (note.status === 'cancelled' || !note.originalInvoiceId) continue;
    const prev = map.get(note.originalInvoiceId) || { count: 0, total: 0 };
    map.set(note.originalInvoiceId, {
      count: prev.count + 1,
      total: prev.total + (note.total || 0),
    });
  }
  return map;
}

export function getSaleDebitContext(
  sale: Sale,
  debitTotalsBySale: Map<string, { count: number; total: number }>,
): SaleDebitContext {
  const prior = debitTotalsBySale.get(sale.id);
  return {
    sale,
    priorDebitCount: prior?.count || 0,
    priorDebitTotal: prior?.total || 0,
    lines: sale.items.map((item) => ({
      item,
      soldQty: item.quantity,
      originalUnitPrice: item.unitPrice,
    })),
  };
}

export function buildDebitLinesFromSale(sale: Sale): DebitLineDraft[] {
  return sale.items.map((item) => ({
    sourceProductId: item.productId,
    soldQty: item.quantity,
    originalUnitPrice: item.unitPrice,
    description: item.productName,
    quantity: 0,
    unitPrice: 0,
    taxRate: item.taxRate ?? DEFAULT_VAT_RATE,
    taxAmount: 0,
    subtotal: 0,
  }));
}

export function buildCustomDebitLine(): DebitLineDraft {
  return recalcDebitLine({
    description: '',
    quantity: 1,
    unitPrice: 0,
    taxRate: DEFAULT_VAT_RATE,
    taxAmount: 0,
    subtotal: 0,
  });
}

export function listDebitEligibleSales(
  sales: Sale[],
  debitNotes: DebitNote[],
): SaleDebitContext[] {
  const debitTotalsBySale = getDebitTotalsBySale(debitNotes);
  return sales
    .filter((sale) => sale.status === 'completed')
    .map((sale) => getSaleDebitContext(sale, debitTotalsBySale))
    .sort((a, b) => new Date(b.sale.createdAt).getTime() - new Date(a.sale.createdAt).getTime());
}

export type DebitNoteDateFilter = '7d' | '30d' | '90d' | 'all';

export function filterDebitEligibleSales(
  entries: SaleDebitContext[],
  opts: {
    searchTerm: string;
    dateFilter: DebitNoteDateFilter;
    onlyWithPriorDebits?: boolean;
  },
): SaleDebitContext[] {
  const term = opts.searchTerm.trim().toLowerCase();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoffs: Record<DebitNoteDateFilter, number | null> = {
    '7d': now - 7 * dayMs,
    '30d': now - 30 * dayMs,
    '90d': now - 90 * dayMs,
    all: null,
  };
  const cutoff = cutoffs[opts.dateFilter];

  return entries.filter((ctx) => {
    if (cutoff != null && new Date(ctx.sale.createdAt).getTime() < cutoff) return false;
    if (opts.onlyWithPriorDebits && ctx.priorDebitCount === 0) return false;
    if (!term) return true;
    const { sale } = ctx;
    return (
      sale.invoiceNumber.toLowerCase().includes(term)
      || sale.customerName?.toLowerCase().includes(term)
      || sale.customerNif?.toLowerCase().includes(term)
      || sale.cashierName?.toLowerCase().includes(term)
      || sale.items.some((item) =>
        item.productName.toLowerCase().includes(term)
        || item.sku.toLowerCase().includes(term),
      )
    );
  });
}

export function debitPreviewTotals(items: DebitNoteItem[]) {
  const active = items.filter((item) => item.description && item.subtotal > 0);
  const subtotal = active.reduce((sum, item) => sum + item.subtotal, 0);
  const taxAmount = active.reduce((sum, item) => sum + item.taxAmount, 0);
  return { subtotal, taxAmount, total: subtotal + taxAmount, active };
}
