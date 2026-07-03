import type { Sale } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import type { User } from '@/types/erp';

export function saleLocalDate(createdAt: string): string {
  const d = new Date(createdAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalDate(): string {
  return saleLocalDate(new Date().toISOString());
}

export function saleInShift(sale: Sale, session: CaixaSession | null | undefined): boolean {
  if (!session?.openedAt) return false;
  const shiftStart = new Date(session.openedAt).getTime();
  if (!Number.isFinite(shiftStart)) return false;
  const saleTime = new Date(sale.createdAt).getTime();
  return Number.isFinite(saleTime) && saleTime >= shiftStart;
}

export function dedupeShiftSales(rows: Sale[]): Sale[] {
  const deduped: Sale[] = [];
  for (const sale of rows) {
    const idx = deduped.findIndex((existing) => {
      const sameInvoice =
        sale.invoiceNumber
        && existing.invoiceNumber
        && sale.invoiceNumber.trim().toUpperCase() === existing.invoiceNumber.trim().toUpperCase();
      return sameInvoice || existing.id === sale.id;
    });
    if (idx < 0) {
      deduped.push(sale);
    } else if ((sale.items?.length ?? 0) > (deduped[idx].items?.length ?? 0)) {
      deduped[idx] = sale;
    }
  }
  return deduped;
}

export function filterShiftSalesForCashier(
  sales: Sale[],
  cashier: User | null | undefined,
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): Sale[] {
  if (!cashier || !session) return [];
  const filtered = sales.filter((sale) => {
    const sameDay = saleLocalDate(sale.createdAt) === day;
    const sameCashier =
      sale.cashierId === cashier.id
      || sale.cashierName === cashier.name
      || sale.cashierName === cashier.username;
    return sameDay && sameCashier && saleInShift(sale, session);
  });
  return dedupeShiftSales(filtered).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
