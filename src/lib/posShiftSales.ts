import type { Sale, CreditNote } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import type { Expense } from '@/types/accounting';
import type { User } from '@/types/erp';
import { branchIdsEquivalent } from '@/lib/branchAccess';
import { timestampLocalDate } from '@/lib/workingDayAccess';

const LAST_CLOSED_PREFIX = 'nexor:pos-caixa-last-closed:v1:';

/** Persist successful EOD close so same-day reopen does not reclaim earlier sales. */
export function markPosCaixaClosed(branchId: string, closedAt = new Date().toISOString()): void {
  const key = String(branchId || '').trim();
  if (!key) return;
  try {
    localStorage.setItem(`${LAST_CLOSED_PREFIX}${key}`, closedAt);
  } catch {
    /* ignore */
  }
}

/**
 * Last successful EOD close that is actually before this session opened.
 * Ignores a leftover close stamp from another PC / failed reopen (close >= open).
 */
function priorShiftClosedAtMs(session: CaixaSession | null | undefined): number {
  if (!session) return NaN;
  const lastClosedIso = getPosCaixaLastClosedAt(session.branchId);
  const lastClosedMs = lastClosedIso ? new Date(lastClosedIso).getTime() : NaN;
  if (!Number.isFinite(lastClosedMs)) return NaN;
  const openedMs = session.openedAt ? new Date(session.openedAt).getTime() : NaN;
  if (Number.isFinite(openedMs) && lastClosedMs >= openedMs) return NaN;
  return lastClosedMs;
}

export function getPosCaixaLastClosedAt(branchId: string | null | undefined): string | null {
  const key = String(branchId || '').trim();
  if (!key) return null;
  try {
    const direct = localStorage.getItem(`${LAST_CLOSED_PREFIX}${key}`);
    if (direct) return direct;
    // Remapped branch ids after update — scan for an equivalent key.
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey?.startsWith(LAST_CLOSED_PREFIX)) continue;
      const id = lsKey.slice(LAST_CLOSED_PREFIX.length);
      if (branchIdsEquivalent(id, key)) {
        return localStorage.getItem(lsKey);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saleLocalDate(createdAt: string): string {
  return timestampLocalDate(createdAt);
}

export function todayLocalDate(): string {
  return saleLocalDate(new Date().toISOString());
}

/** Business day of the open register (YYYY-MM-DD), not the clock after midnight. */
export function shiftBusinessDate(
  session: CaixaSession | null | undefined,
  fallback = todayLocalDate(),
): string {
  const raw = String(session?.date || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (session?.openedAt) return saleLocalDate(session.openedAt);
  return fallback;
}

function expensePaidTimestamp(expense: Expense): string | undefined {
  // Never use updatedAt — a later edit/sync would move a closed-day expense onto today.
  const raw = expense.paidAt || expense.createdAt || expense.requestedAt;
  if (raw == null || raw === '') return undefined;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? raw.toISOString() : undefined;
  }
  const text = String(raw).trim();
  return text || undefined;
}

function personKeys(...values: Array<string | null | undefined>): string[] {
  const keys = values
    .map((value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  return [...new Set(keys)];
}

export function isSameShiftCashier(
  sale: Sale,
  cashier: User | null | undefined,
  extraIds: string[] = [],
): boolean {
  if (!cashier) return false;
  const keys = personKeys(cashier.id, cashier.name, cashier.username, ...extraIds);
  const saleKeys = personKeys(sale.cashierId, sale.cashierName);
  if (keys.length === 0 || saleKeys.length === 0) return false;
  return saleKeys.some((key) => keys.includes(key));
}

/** Map POS / DB payment labels onto cash | card | transfer | mixed | credit. */
export function normalizePosPaymentMethod(raw: string | undefined | null): string {
  const k = String(raw || 'cash')
    .trim()
    .toLowerCase()
    .replace(/[áàâã]/g, 'a')
    .replace(/[éê]/g, 'e')
    .replace(/[í]/g, 'i')
    .replace(/[óôõ]/g, 'o')
    .replace(/[ú]/g, 'u')
    .replace(/ç/g, 'c');
  if (!k || k === 'cash' || k === 'dinheiro' || k === 'numerario') return 'cash';
  if (k === 'card' || k === 'cartao' || k === 'tpa' || k === 'multicaixa' || k === 'debit' || k === 'debito') {
    return 'card';
  }
  if (k === 'transfer' || k === 'transferencia' || k === 'tb' || k === 'iban') return 'transfer';
  if (k === 'mixed' || k === 'misto') return 'mixed';
  if (k === 'credit' || k === 'credito' || k === 'conta' || k === 'on_account' || k === 'on-account') {
    return 'credit';
  }
  return k;
}

/**
 * When a cashier was forced to re-open after an update (without closing),
 * backdate the shift start to the first same-day sale so invoices reappear.
 * Returns the original openedAt when nothing needs healing.
 *
 * Never backdate across a successful EOD close — that made "close register"
 * look broken: reopen pulled all earlier same-day sales (and cash) back in.
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

  const lastClosedMs = priorShiftClosedAtMs(session);

  let earliestMs = openedMs;
  let earliestIso = session.openedAt;

  const consider = (sale: Sale) => {
    if (String(sale.status || '').toLowerCase() === 'voided') return;
    if (saleLocalDate(sale.createdAt) !== day) return;
    if (session.branchId && sale.branchId && !branchIdsEquivalent(sale.branchId, session.branchId)) {
      return;
    }
    const saleMs = new Date(sale.createdAt).getTime();
    if (!Number.isFinite(saleMs)) return;
    // Sales at/before the last EOD close belong to the previous shift (same calendar day).
    if (Number.isFinite(lastClosedMs) && saleMs <= lastClosedMs) return;
    if (saleMs < earliestMs) {
      earliestMs = saleMs;
      earliestIso = sale.createdAt;
    }
  };

  if (cashier) {
    for (const sale of sales) {
      if (!isSameShiftCashier(sale, cashier, session.openedBy ? [session.openedBy] : [])) continue;
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
  const saleTime = new Date(sale.createdAt).getTime();
  if (!Number.isFinite(saleTime)) return false;
  // Do not require createdAt >= openedAt: a late reopen after an update would hide
  // the morning's invoices. Same-day filtering happens in the caller.
  const lastClosedMs = priorShiftClosedAtMs(session);
  if (Number.isFinite(lastClosedMs) && saleTime <= lastClosedMs) return false;
  return true;
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

export function filterShiftSalesInWindow(
  sales: Sale[],
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
  cashier: User | null | undefined = null,
): Sale[] {
  if (!session) return [];
  const effective = withRecoveredShiftStart(session, sales, cashier, day);

  const matchesBranch = (sale: Sale) =>
    !session.branchId
    || !sale.branchId
    || branchIdsEquivalent(sale.branchId, session.branchId);

  const filtered = sales.filter((sale) => {
    if (String(sale.status || '').toLowerCase() === 'voided') return false;
    const sameDay = saleLocalDate(sale.createdAt) === day;
    return sameDay && matchesBranch(sale) && saleInShift(sale, effective);
  });

  return dedupeShiftSales(filtered).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function filterShiftSalesForCashier(
  sales: Sale[],
  cashier: User | null | undefined,
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): Sale[] {
  if (!cashier || !session) return [];
  const extra = session.openedBy ? [session.openedBy] : [];
  return filterShiftSalesInWindow(sales, session, day, cashier).filter((sale) =>
    isSameShiftCashier(sale, cashier, extra),
  );
}

/**
 * Caixa close report: prefer this cashier's sales, but if none match (offline
 * ids, missing cashier_name, or the closer is not the seller) fall back to
 * every sale on the open register for that business day.
 */
export function selectEndOfDaySales(
  sales: Sale[],
  cashier: User | null | undefined,
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): { rows: Sale[]; scopedToCashier: boolean } {
  const windowRows = filterShiftSalesInWindow(sales, session, day, null);
  if (!cashier) return { rows: windowRows, scopedToCashier: false };
  const mine = filterShiftSalesForCashier(sales, cashier, session, day);
  if (mine.length > 0) return { rows: mine, scopedToCashier: true };
  return { rows: windowRows, scopedToCashier: false };
}

/**
 * POS Shift invoices tab: prefer this cashier's shift, then the register window,
 * then every same-day sale already loaded for this till (API is branch-scoped).
 * Late caixa open, leftover last-closed stamps, or cashier-id mismatch must not
 * blank the list while Invoices/dashboard still shows the day's tickets.
 */
export function selectPosShiftInvoices(
  sales: Sale[],
  cashier: User | null | undefined,
  session: CaixaSession | null | undefined,
  day = todayLocalDate(),
): { rows: Sale[]; scopedToCashier: boolean } {
  const selected = selectEndOfDaySales(sales, cashier, session, day);
  const today = todayLocalDate();
  const extra = sales.filter((sale) => {
    if (String(sale.status || '').toLowerCase() === 'voided') return false;
    if (selected.rows.some((row) => row.id === sale.id)) return false;
    const saleDay = saleLocalDate(sale.createdAt);
    if (saleDay && saleDay !== day && saleDay !== today) return false;
    return true;
  });
  if (extra.length === 0) return selected;
  return {
    rows: dedupeShiftSales([...extra, ...selected.rows]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
    scopedToCashier: selected.scopedToCashier,
  };
}

function eventInShift(isoTimestamp: string | undefined, session: CaixaSession | null | undefined): boolean {
  if (!session?.openedAt || !isoTimestamp) return false;
  const eventTime = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(eventTime)) return false;
  const lastClosedMs = priorShiftClosedAtMs(session);
  if (Number.isFinite(lastClosedMs) && eventTime <= lastClosedMs) return false;
  return true;
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
 * Same rules as sales/refunds: the shift window (openedAt / last EOD close)
 * plus the register's business day. An overnight close still lists that day's
 * expenses; a new session the next morning does not.
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
  const reportDay = day || shiftBusinessDate(session);
  const effective = withRecoveredShiftStart(session, sales, cashier ?? null, reportDay);
  const sessionDay = shiftBusinessDate(effective, reportDay);
  return expenses.filter((expense) => {
    if (String(expense.status || '').toLowerCase() !== 'paid') return false;
    const source = String(expense.paymentSource || '').trim().toLowerCase();
    if (source && source !== 'caixa') return false;
    if (!branchIdsEquivalent(expense.branchId, effective.branchId)) return false;
    const paidAt = expensePaidTimestamp(expense);
    if (!paidAt) return false;
    const paidDay = saleLocalDate(paidAt);
    const clockDay = todayLocalDate();
    // New session today: previous calendar day's expenses stay on the closed day.
    // Overnight close (session.date still yesterday): keep that day's payments,
    // plus anything paid after midnight before they actually close.
    if (sessionDay === clockDay) {
      if (paidDay !== sessionDay) return false;
    } else if (paidDay < sessionDay) {
      return false;
    }
    return eventInShift(paidAt, effective);
  });
}
