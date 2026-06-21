export type PurchasesGroupBy = 'supplier' | 'product' | 'category' | 'month';

export interface PurchaseRow {
  key: string;
  label: string;
  qty: number;
  total: number;
  invoices: number;
}

export interface PurchaseTotals {
  qty: number;
  total: number;
  invoices: number;
}

export interface PurchasesPivotContext {
  /** Resolve a purchased line's product category for grouping. */
  productCategory: (productId: string | undefined, fallback: string) => string;
  labels: {
    unknown: string;
    noCategory: string;
  };
}

const lineQty = (l: Record<string, unknown>): number =>
  Number((l.totalQty ?? l.quantity ?? 0) as number) || 0;

const lineAmount = (l: Record<string, unknown>): number =>
  Number((l.totalWithIva ?? l.lineTotal ?? l.total ?? 0) as number) || 0;

/**
 * Aggregates purchase invoices by the chosen dimension. Supplier/month group at
 * the invoice level; product/category group at the line level (counting the
 * distinct invoices each appears in).
 */
export function buildPurchasesPivot(
  invoices: Array<Record<string, any>>,
  groupBy: PurchasesGroupBy,
  ctx: PurchasesPivotContext,
): { rows: PurchaseRow[]; totals: PurchaseTotals } {
  const acc = new Map<string, { label: string; qty: number; total: number; invoiceIds: Set<string> }>();

  const bump = (key: string, label: string, qty: number, total: number, invoiceId: string) => {
    if (!key) return;
    const entry = acc.get(key) || { label, qty: 0, total: 0, invoiceIds: new Set<string>() };
    entry.qty += qty;
    entry.total += total;
    if (invoiceId) entry.invoiceIds.add(invoiceId);
    acc.set(key, entry);
  };

  invoices.forEach((inv, idx) => {
    const invoiceId = String(inv.id ?? inv.number ?? idx);
    const lines: Array<Record<string, any>> = Array.isArray(inv.lines) ? inv.lines : [];

    if (groupBy === 'supplier' || groupBy === 'month') {
      const qty = lines.reduce((s, l) => s + lineQty(l), 0);
      const total = Number(inv.total || 0);
      if (groupBy === 'supplier') {
        const key = String(inv.supplierId || inv.supplierName || 'unknown');
        bump(key, String(inv.supplierName || ctx.labels.unknown), qty, total, invoiceId);
      } else {
        const month = String(inv.date || inv.createdAt || '').slice(0, 7);
        bump(month || ctx.labels.unknown, month || ctx.labels.unknown, qty, total, invoiceId);
      }
      return;
    }

    // product / category — line level
    lines.forEach((l) => {
      const name = String(l.productName || l.description || l.name || '').trim();
      const qty = lineQty(l);
      const total = lineAmount(l);
      if (groupBy === 'product') {
        if (!name) return;
        const key = String(l.productId || name.toLowerCase());
        bump(key, name, qty, total, invoiceId);
      } else {
        const cat = ctx.productCategory(l.productId ? String(l.productId) : undefined, ctx.labels.noCategory);
        bump(cat, cat, qty, total, invoiceId);
      }
    });
  });

  const totals: PurchaseTotals = { qty: 0, total: 0, invoices: 0 };
  const rows: PurchaseRow[] = Array.from(acc.entries()).map(([key, e]) => {
    const invoices = e.invoiceIds.size;
    totals.qty += e.qty;
    totals.total += e.total;
    totals.invoices += invoices;
    return { key, label: e.label, qty: e.qty, total: e.total, invoices };
  });

  if (groupBy === 'month') rows.sort((a, b) => a.label.localeCompare(b.label));
  else rows.sort((a, b) => b.total - a.total);

  return { rows, totals };
}
