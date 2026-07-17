import type { Sale, CreditNote } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import type { Expense } from '@/types/accounting';
import type { User } from '@/types/erp';
import { branchIdsEquivalent } from '@/lib/branchAccess';

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
    if (session.branchId && note.branchId && !branchIdsEquivalent(note.branchId, session.branchId)) {
      return false;
    }
    const issuedDay = saleLocalDate(note.issuedAt || note.createdAt);
    if (issuedDay !== day) return false;
    if (!creditNoteInShift(note, session)) return false;
    const original = saleById.get(note.originalInvoiceId);
    const method = String(original?.paymentMethod || note.originalPaymentMethod || '').toLowerCase();
    // When the original sale isn't in the loaded list and no method is stored, include the
    // note so it stays visible; the server reconciliation is authoritative for the amount.
    if (!method) return true;
    return method === 'cash';
  });
}

/**
 * Expenses paid from caixa during this shift (same branch).
 * Like credit notes: do NOT require expense.caixaId === session.caixaId —
 * users often open "Caixa Principal" but pay from the COA "Caixa - SOYO XX".
 *
 * Uses the open-shift window only (not calendar day) so overnight open registers
 * still show expenses, matching how the drawer session counters work.
 */
export function filterShiftCashExpenses(
  expenses: Expense[],
  session: CaixaSession | null | undefined,
  _caixaId?: string,
  _day = todayLocalDate(),
): Expense[] {
  if (!session) return [];
  return expenses.filter((expense) => {
    if (String(expense.status || '').toLowerCase() !== 'paid') return false;
    const source = String(expense.paymentSource || '').trim().toLowerCase();
    if (source && source !== 'caixa') return false;
    if (!branchIdsEquivalent(expense.branchId, session.branchId)) return false;
    const paidAt = expense.paidAt || expense.updatedAt || expense.createdAt;
    if (!paidAt) return false;
    return eventInShift(paidAt, session);
  });
}
