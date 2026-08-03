import type { CreditNote, CreditNoteItem, Sale } from '@/types/erp';

export type SaleCreditLine = {
  item: Sale['items'][number];
  soldQty: number;
  creditedQty: number;
  remainingQty: number;
};

export type SaleCreditContext = {
  sale: Sale;
  lines: SaleCreditLine[];
  totalRemaining: number;
  remainingValue: number;
  creditedValue: number;
  fullyCredited: boolean;
  hasPriorCredits: boolean;
};

export function buildCreditLineAmounts(
  qty: number,
  unitPrice: number,
  discount: number,
  taxRate: number,
) {
  const subtotal = qty * unitPrice * (1 - (discount || 0) / 100);
  const taxAmount = subtotal * (taxRate / 100);
  return { subtotal, taxAmount };
}

export function getCreditedQtyBySale(creditNotes: CreditNote[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const note of creditNotes) {
    if (note.status === 'cancelled') continue;
    if (!note.originalInvoiceId) continue;
    if (!map.has(note.originalInvoiceId)) {
      map.set(note.originalInvoiceId, new Map());
    }
    const productMap = map.get(note.originalInvoiceId)!;
    for (const item of note.items) {
      if (!item.productId) continue;
      productMap.set(item.productId, (productMap.get(item.productId) || 0) + item.quantity);
    }
  }
  return map;
}

export function getSaleCreditContext(
  sale: Sale,
  creditedQtyBySale: Map<string, Map<string, number>>,
): SaleCreditContext {
  const credited = creditedQtyBySale.get(sale.id);
  const lines: SaleCreditLine[] = sale.items.map((item) => {
    const soldQty = item.quantity;
    const creditedQty = credited?.get(item.productId) || 0;
    const remainingQty = Math.max(0, soldQty - creditedQty);
    return { item, soldQty, creditedQty, remainingQty };
  });

  let remainingValue = 0;
  let creditedValue = 0;
  for (const line of lines) {
    if (line.creditedQty > 0) {
      const amounts = buildCreditLineAmounts(
        line.creditedQty,
        line.item.unitPrice,
        line.item.discount,
        line.item.taxRate,
      );
      creditedValue += amounts.subtotal + amounts.taxAmount;
    }
    if (line.remainingQty > 0) {
      const amounts = buildCreditLineAmounts(
        line.remainingQty,
        line.item.unitPrice,
        line.item.discount,
        line.item.taxRate,
      );
      remainingValue += amounts.subtotal + amounts.taxAmount;
    }
  }

  const totalRemaining = lines.reduce((sum, line) => sum + line.remainingQty, 0);
  return {
    sale,
    lines,
    totalRemaining,
    remainingValue,
    creditedValue,
    fullyCredited: totalRemaining === 0,
    hasPriorCredits: creditedValue > 0,
  };
}

export function buildCreditItemsFromContext(ctx: SaleCreditContext): CreditNoteItem[] {
  return ctx.lines
    .filter((line) => line.remainingQty > 0)
    .map((line) => {
      const { subtotal, taxAmount } = buildCreditLineAmounts(
        line.remainingQty,
        line.item.unitPrice,
        line.item.discount,
        line.item.taxRate,
      );
      return {
        productId: line.item.productId,
        productName: line.item.productName,
        sku: line.item.sku,
        quantity: line.remainingQty,
        unitPrice: line.item.unitPrice,
        taxRate: line.item.taxRate,
        taxAmount,
        subtotal,
      };
    });
}

export function listCreditableSales(
  sales: Sale[],
  creditNotes: CreditNote[],
): SaleCreditContext[] {
  const creditedQtyBySale = getCreditedQtyBySale(creditNotes);
  return sales
    .filter((sale) => sale.status === 'completed')
    .map((sale) => getSaleCreditContext(sale, creditedQtyBySale))
    .filter((ctx) => {
      // Light sales lists omit line items (items=[]). Those must still appear —
      // otherwise every invoice looks "fully credited" and the CN picker is empty.
      const itemCount = ctx.sale.items?.length || 0;
      if (itemCount === 0) {
        const hinted =
          Number(ctx.sale.itemsCount) > 0
          || Number(ctx.sale.total) > 0
          || Number(ctx.sale.subtotal) > 0;
        return hinted;
      }
      return !ctx.fullyCredited;
    })
    .sort((a, b) => new Date(b.sale.createdAt).getTime() - new Date(a.sale.createdAt).getTime());
}

export type CreditNoteDateFilter = '7d' | '30d' | '90d' | 'all';

export function filterCreditableSales(
  entries: SaleCreditContext[],
  opts: {
    searchTerm: string;
    dateFilter: CreditNoteDateFilter;
    onlyWithPriorCredits?: boolean;
  },
): SaleCreditContext[] {
  const term = opts.searchTerm.trim().toLowerCase();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoffs: Record<CreditNoteDateFilter, number | null> = {
    '7d': now - 7 * dayMs,
    '30d': now - 30 * dayMs,
    '90d': now - 90 * dayMs,
    all: null,
  };
  const cutoff = cutoffs[opts.dateFilter];

  return entries.filter((ctx) => {
    if (cutoff != null && new Date(ctx.sale.createdAt).getTime() < cutoff) return false;
    if (opts.onlyWithPriorCredits && !ctx.hasPriorCredits) return false;
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
