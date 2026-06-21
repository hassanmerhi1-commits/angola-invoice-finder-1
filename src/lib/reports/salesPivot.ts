import type { Sale } from '@/types/erp';

export type SalesGroupBy = 'item' | 'category' | 'customer' | 'supplier' | 'warehouse' | 'user' | 'month';

export interface PivotRow {
  key: string;
  label: string;
  qty: number;
  /** Revenue excluding VAT (taxable base). */
  base: number;
  /** Revenue including VAT. */
  withVat: number;
  cost: number;
  profit: number;
  marginPct: number;
  /** Optional secondary grouping label (e.g. category for the item dimension). */
  group?: string;
}

export interface PivotTotals {
  qty: number;
  base: number;
  withVat: number;
  cost: number;
  profit: number;
}

export interface ProductMeta {
  category: string;
  supplierName: string;
  cost: number;
}

export interface SalesPivotContext {
  /** productId -> metadata (category, supplier, unit cost). */
  productMeta: Map<string, ProductMeta>;
  /** Resolve a branch/warehouse id to a display name. */
  branchName: (id: string) => string;
  labels: {
    noCategory: string;
    noSupplier: string;
    finalConsumer: string;
    unknownUser: string;
  };
}

const emptyTotals = (): PivotTotals => ({ qty: 0, base: 0, withVat: 0, cost: 0, profit: 0 });

/**
 * Aggregates completed-sale line items by the chosen dimension.
 * `item.subtotal` is the ex-VAT base and `item.taxAmount` is VAT on top
 * (see useERP cart math), so withVat = base + vat.
 */
export function buildSalesPivot(
  sales: Sale[],
  groupBy: SalesGroupBy,
  ctx: SalesPivotContext,
): { rows: PivotRow[]; totals: PivotTotals } {
  const acc = new Map<string, { label: string; qty: number; base: number; vat: number; cost: number; group?: string }>();

  for (const sale of sales) {
    for (const item of sale.items) {
      const meta = ctx.productMeta.get(item.productId);
      const qty = Number(item.quantity || 0);
      const base = Number(item.subtotal || 0);
      const vat = Number(item.taxAmount || 0);
      const cost = (meta?.cost ?? 0) * qty;

      let key: string;
      let label: string;
      switch (groupBy) {
        case 'item':
          key = item.productId || item.sku || item.productName;
          label = item.productName || meta?.category || key;
          break;
        case 'category':
          label = meta?.category || ctx.labels.noCategory;
          key = label;
          break;
        case 'supplier':
          label = meta?.supplierName || ctx.labels.noSupplier;
          key = label;
          break;
        case 'customer':
          label = (sale.customerName || '').trim() || ctx.labels.finalConsumer;
          key = ((sale.customerNif || '').trim() || label).toLowerCase();
          break;
        case 'warehouse':
          label = ctx.branchName(sale.branchId) || ctx.labels.unknownUser;
          key = sale.branchId || label;
          break;
        case 'user':
          label = (sale.cashierName || '').trim() || sale.cashierId || ctx.labels.unknownUser;
          key = sale.cashierId || label;
          break;
        case 'month':
          label = String(sale.createdAt || '').slice(0, 7);
          key = label;
          break;
        default:
          key = 'all';
          label = 'all';
      }

      if (!key) continue;
      const entry = acc.get(key) || { label, qty: 0, base: 0, vat: 0, cost: 0 };
      if (groupBy === 'item' && entry.group === undefined) {
        entry.group = meta?.category || ctx.labels.noCategory;
      }
      entry.qty += qty;
      entry.base += base;
      entry.vat += vat;
      entry.cost += cost;
      acc.set(key, entry);
    }
  }

  const totals = emptyTotals();
  const rows: PivotRow[] = Array.from(acc.entries()).map(([key, e]) => {
    const withVat = e.base + e.vat;
    const profit = e.base - e.cost;
    totals.qty += e.qty;
    totals.base += e.base;
    totals.withVat += withVat;
    totals.cost += e.cost;
    totals.profit += profit;
    return {
      key,
      label: e.label,
      qty: e.qty,
      base: e.base,
      withVat,
      cost: e.cost,
      profit,
      marginPct: e.base > 0 ? (profit / e.base) * 100 : 0,
      group: e.group,
    };
  });

  // Month sorts chronologically; everything else by revenue desc.
  if (groupBy === 'month') rows.sort((a, b) => a.label.localeCompare(b.label));
  else rows.sort((a, b) => b.base - a.base);

  return { rows, totals };
}
