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

export function isSameShiftCashier(
  sale: Sale,
  cashier: User | null | undefined,
): boolean {
  if (!cashier) return false;
  const id = String(cashier.id || '').trim().toLowerCase();
  const name = String(cashier.name || '').trim().toLowerCase();
  const username = String(cashier.username || '').trim().toLowerCase();
  const saleCashierId = String(sale.cashierId || '').trim().toLowerCase();
  const saleCashierName = String(sale.cashierName || '').trim().toLowerCase();
  if (id && saleCashierId && saleCashierId === id) return true;
  if (name && saleCashierName && saleCashierName === name) return true;
  if (username && saleCashierName && saleCashierName === username) return true;
  // Some POS builds store username in cashierId when the UUID was unavailable offline.
  if (username && saleCashierId && saleCashierId === username) return true;
  if (name && saleCashierId && saleCashierId === name) return true;
  return false;
}

/**
 * When a cashier was forced to re-open after an update (without closing),
 * backdate the shift start to the first same-day sale so invoices reappear.
 * Returns the original openedAt when nothing needs healing.
 */
export function recoveredShiftOpenedAt(
  sales: Sale[],
  cashier: User | null | undefined,
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): string | null {
  if (!session?.openedAt) return null;
  const openedMs = new Date(session.openedAt).getTime();
  if (!Number.isFinite(openedMs)) return session.openedAt;

  let earliestMs = openedMs;
  let earliestIso = session.openedAt;

  const consider = (sale: Sale) => {
    if (saleLocalDate(sale.createdAt) !== day) return;
    if (session.branchId && sale.branchId && !branchIdsEquivalent(sale.branchId, session.branchId)) {
      return;
    }
    const saleMs = new Date(sale.createdAt).getTime();
    if (!Number.isFinite(saleMs)) return;
    if (saleMs < earliestMs) {
      earliestMs = saleMs;
      earliestIso = sale.createdAt;
    }
  };

  if (cashier) {
    for (const sale of sales) {
      if (!isSameShiftCashier(sale, cashier)) continue;
      consider(sale);
    }
    // Never fall back to another cashier's earliest sale — that mixes shifts on EOD.
    return earliestIso;
  }

  // No cashier context: heal from earliest branch sale today.
  for (const sale of sales) consider(sale);

  return earliestIso;
}

export function withRecoveredShiftStart(
  session: CaixaSession,
  sales: Sale[],
  cashier: User | null | undefined,
  day = todayLocalDate(),
): CaixaSession {
  const recovered = recoveredShiftOpenedAt(sales, cashier, session, day);
  if (!recovered || recovered === session.openedAt) return session;
  const recoveredMs = new Date(recovered).getTime();
  const openedMs = new Date(session.openedAt).getTime();
  if (!Number.isFinite(recoveredMs) || recoveredMs >= openedMs) return session;
  return { ...session, openedAt: recovered };
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
  const effective = withRecoveredShiftStart(session, sales, cashier, day);

  const matchesBranch = (sale: Sale) =>
    !session.branchId
    || !sale.branchId
    || branchIdsEquivalent(sale.branchId, session.branchId);

  // Strict: only this cashier's sales. Never expand to the whole branch —
  // that made every Soyo-02 cashier see combined EOD totals.
  const filtered = sales.filter((sale) => {
    const sameDay = saleLocalDate(sale.createdAt) === day;
    const sameCashier = isSameShiftCashier(sale, cashier);
    return sameDay && sameCashier && matchesBranch(sale) && saleInShift(sale, effective);
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
  cashier: User | null | undefined,
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): CreditNote[] {
  if (!session) return [];
  const effective = withRecoveredShiftStart(session, sales, cashier, day);
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  return creditNotes.filter((note) => {
    if (note.status !== 'issued') return false;
    if (effective.branchId && note.branchId && !branchIdsEquivalent(note.branchId, effective.branchId)) {
      return false;
    }
    const issuedDay = saleLocalDate(note.issuedAt || note.createdAt);
    if (issuedDay !== day) return false;
    if (!creditNoteInShift(note, effective)) return false;
    const original = saleById.get(note.originalInvoiceId);
    if (cashier && original && !isSameShiftCashier(original, cashier)) {
      return false;
    }
    // Credit notes issued by this cashier (even if original sale list is incomplete).
    if (cashier && !original) {
      const issuer = String(note.issuedBy || '').trim().toLowerCase();
      const id = String(cashier.id || '').trim().toLowerCase();
      const name = String(cashier.name || '').trim().toLowerCase();
      const username = String(cashier.username || '').trim().toLowerCase();
      if (issuer && issuer !== id && issuer !== name && issuer !== username) {
        return false;
      }
    }
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
 *
 * Expenses are caixa/drawer movements — the payment UI picks a cash box, not a
 * cashier — so this list is intentionally NOT filtered by cashier. Callers decide
 * whether to show them as shared info or fold them into drawer close once.
 */
export function filterShiftCashExpenses(
  expenses: Expense[],
  session: CaixaSession | null | undefined,
  sales: Sale[] = [],
  cashier?: User | null,
  _caixaId?: string,
  day = todayLocalDate(),
): Expense[] {
  if (!session) return [];
  const effective = withRecoveredShiftStart(session, sales, cashier ?? null, day);
  return expenses.filter((expense) => {
    if (String(expense.status || '').toLowerCase() !== 'paid') return false;
    const source = String(expense.paymentSource || '').trim().toLowerCase();
    if (source && source !== 'caixa') return false;
    if (!branchIdsEquivalent(expense.branchId, effective.branchId)) return false;
    const paidAt = expense.paidAt || expense.updatedAt || expense.createdAt;
    if (!paidAt) return false;
    return eventInShift(paidAt, effective);
  });
}
