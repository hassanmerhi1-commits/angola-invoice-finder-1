import type { Sale, CreditNote } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import type { Expense } from '@/types/accounting';
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

function eventInShift(isoTimestamp: string | undefined, session: CaixaSession | null | undefined): boolean {
  if (!session?.openedAt || !isoTimestamp) return false;
  const shiftStart = new Date(session.openedAt).getTime();
  if (!Number.isFinite(shiftStart)) return false;
  const eventTime = new Date(isoTimestamp).getTime();
  return Number.isFinite(eventTime) && eventTime >= shiftStart;
}

function creditNoteInShift(note: CreditNote, session: CaixaSession | null | undefined): boolean {
  return eventInShift(note.issuedAt || note.createdAt, session);
}

/** Credit notes issued this shift against cash POS sales (drawer refunds). */
export function filterShiftCashRefunds(
  creditNotes: CreditNote[],
  sales: Sale[],
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): CreditNote[] {
  if (!session) return [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  return creditNotes.filter((note) => {
    if (note.status !== 'issued') return false;
    if (session.branchId && note.branchId !== session.branchId) return false;
    const issuedDay = saleLocalDate(note.issuedAt || note.createdAt);
    if (issuedDay !== day) return false;
    if (!creditNoteInShift(note, session)) return false;
    const original = saleById.get(note.originalInvoiceId);
    return String(original?.paymentMethod || '').toLowerCase() === 'cash';
  });
}

/** Expenses paid from the open caixa during this shift. */
export function filterShiftCashExpenses(
  expenses: Expense[],
  session: CaixaSession | null | undefined,
  caixaId?: string,
  day = todayLocalDate(),
): Expense[] {
  if (!session) return [];
  return expenses.filter((expense) => {
    if (expense.status !== 'paid') return false;
    if (expense.paymentSource !== 'caixa') return false;
    if (expense.branchId !== session.branchId) return false;
    if (caixaId && expense.caixaId !== caixaId) return false;
    if (!expense.paidAt) return false;
    if (saleLocalDate(expense.paidAt) !== day) return false;
    return eventInShift(expense.paidAt, session);
  });
}
