import { isOpenItemDebit } from '@/lib/openItems';

export type AccountStatementParty = 'customer' | 'supplier';

export type AccountStatementMovementType =
  | 'opening'
  | 'invoice'
  | 'purchase'
  | 'receipt'
  | 'payment'
  | 'credit_note'
  | 'debit_note'
  | 'advance';

export type AccountStatementMovement = {
  id: string;
  date: string;
  type: AccountStatementMovementType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

export type AccountStatementLabels = {
  invoice: string;
  purchase: string;
  receipt: string;
  payment: string;
  creditNote: string;
  debitNote: string;
  advance: string;
  openingBalance: string;
  paymentWithMethod: string;
  methodCash: string;
  methodCard: string;
  methodTransfer: string;
  methodCheque: string;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' ? (value as RawRecord) : {};
}

function str(value: unknown): string {
  return String(value ?? '').trim();
}

function isoDate(value: unknown): string {
  const s = str(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function amount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function paymentMethodLabel(method: string, labels: AccountStatementLabels): string {
  if (method === 'cash') return labels.methodCash;
  if (method === 'card') return labels.methodCard;
  if (method === 'transfer') return labels.methodTransfer;
  if (method === 'cheque' || method === 'check') return labels.methodCheque;
  return method;
}

export function normalizeStatementPayload(data: unknown) {
  const d = asRecord(data);
  return {
    openItems: (d.openItems ?? d.open_items ?? []) as RawRecord[],
    payments: (d.payments ?? []) as RawRecord[],
    sales: (d.sales ?? []) as RawRecord[],
    creditNotes: (d.creditNotes ?? d.credit_notes ?? []) as RawRecord[],
    debitNotes: (d.debitNotes ?? d.debit_notes ?? []) as RawRecord[],
    purchases: (d.purchases ?? []) as RawRecord[],
  };
}

function classifyOpenItem(
  docType: string,
  party: AccountStatementParty,
): AccountStatementMovementType {
  if (docType === 'credit_note' || docType === 'supplier_return' || docType === 'purchase_return') {
    return 'credit_note';
  }
  if (docType === 'debit_note') return 'debit_note';
  if (docType === 'advance' || docType === 'advance_payment') return 'advance';
  if (party === 'supplier') return 'purchase';
  return 'invoice';
}

function describe(
  type: AccountStatementMovementType,
  labels: AccountStatementLabels,
  extra?: string,
): string {
  const base =
    type === 'invoice' ? labels.invoice
    : type === 'purchase' ? labels.purchase
    : type === 'receipt' ? labels.receipt
    : type === 'payment' ? labels.payment
    : type === 'credit_note' ? labels.creditNote
    : type === 'debit_note' ? labels.debitNote
    : type === 'advance' ? labels.advance
    : labels.openingBalance;
  return extra ? `${base} — ${extra}` : base;
}

function signedDelta(party: AccountStatementParty, debit: number, credit: number): number {
  return party === 'customer' ? debit - credit : credit - debit;
}

export function buildAccountStatement(opts: {
  party: AccountStatementParty;
  dateFrom: string;
  dateTo: string;
  payload: unknown;
  labels: AccountStatementLabels;
}): {
  openingBalance: number;
  lines: AccountStatementMovement[];
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
} {
  const { party, dateFrom, dateTo, labels } = opts;
  const { openItems, payments, sales, creditNotes, debitNotes, purchases } = normalizeStatementPayload(opts.payload);

  const paymentRefs = new Set<string>();
  for (const raw of payments) {
    const ref = str(raw.payment_number ?? raw.paymentNumber);
    if (ref) paymentRefs.add(ref);
  }

  const rawMoves: Omit<AccountStatementMovement, 'balance'>[] = [];
  const seen = new Set<string>();

  for (const raw of openItems) {
    const docType = str(raw.document_type ?? raw.documentType).toLowerCase();
    const docNumber = str(raw.document_number ?? raw.documentNumber);
    if (docType === 'payment' || docType === 'advance_payment') {
      if (!docNumber || paymentRefs.has(docNumber)) continue;
    }
    const docId = str(raw.document_id ?? raw.documentId);
    const dedupe = docNumber ? `oi:${docNumber}` : `oi:${str(raw.id)}`;
    if (seen.has(dedupe) || (docId && seen.has(`sale:${docId}`))) continue;
    seen.add(dedupe);
    if (docId) seen.add(`sale:${docId}`);

    const original = amount(raw.original_amount ?? raw.originalAmount);
    if (Math.abs(original) < 0.005) continue;

    const type = classifyOpenItem(docType, party);
    const debitFlag = isOpenItemDebit(raw.is_debit ?? raw.isDebit);
    let debit = 0;
    let credit = 0;
    if (party === 'customer') {
      if (debitFlag) debit = original;
      else credit = original;
    } else if (debitFlag) {
      credit = original;
    } else {
      debit = original;
    }

    rawMoves.push({
      id: str(raw.id) || dedupe,
      date: isoDate(raw.document_date ?? raw.documentDate ?? raw.created_at ?? raw.createdAt),
      type,
      reference: docNumber,
      description: describe(type, labels),
      debit,
      credit,
    });
  }

  for (const raw of payments) {
    const payRef = str(raw.payment_number ?? raw.paymentNumber);
    const dedupe = payRef ? `pay:${payRef}` : `pay:${str(raw.id)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const value = amount(raw.amount);
    if (Math.abs(value) < 0.005) continue;

    const payType = str(raw.payment_type ?? raw.paymentType).toLowerCase();
    const isReceipt = party === 'customer' || payType === 'receipt' || payType.startsWith('rec');
    const type: AccountStatementMovementType = isReceipt ? 'receipt' : 'payment';
    const method = str(raw.payment_method ?? raw.paymentMethod);
    const notes = str(raw.notes ?? raw.reference);
    const methodLabel = paymentMethodLabel(method, labels);
    const extra = notes || (method ? labels.paymentWithMethod.replace('{method}', methodLabel) : '');

    rawMoves.push({
      id: str(raw.id) || dedupe,
      date: isoDate(raw.created_at ?? raw.createdAt),
      type,
      reference: payRef,
      description: extra ? describe(type, labels, extra) : describe(type, labels),
      debit: isReceipt ? 0 : value,
      credit: isReceipt ? value : 0,
    });
  }

  for (const raw of sales) {
    const status = str(raw.status).toLowerCase();
    if (status === 'voided' || status === 'cancelled' || status === 'canceled') continue;
    const docNumber = str(raw.invoice_number ?? raw.invoiceNumber);
    const docId = str(raw.id);
    const dedupe = docNumber ? `oi:${docNumber}` : `sale:${docId}`;
    if (seen.has(dedupe) || (docId && seen.has(`sale:${docId}`))) continue;
    seen.add(dedupe);
    if (docId) seen.add(`sale:${docId}`);

    const total = amount(raw.total);
    if (Math.abs(total) < 0.005) continue;
    const paid = amount(raw.amount_paid ?? raw.amountPaid);
    const method = str(raw.payment_method ?? raw.paymentMethod).toLowerCase();
    const onAccount = method === 'credit';

    rawMoves.push({
      id: docId || dedupe,
      date: isoDate(raw.created_at ?? raw.createdAt),
      type: 'invoice',
      reference: docNumber,
      description: describe('invoice', labels),
      debit: total,
      credit: onAccount ? 0 : (paid >= total - 0.005 ? total : Math.max(0, paid)),
    });
  }

  for (const raw of creditNotes) {
    const docNumber = str(raw.document_number ?? raw.documentNumber);
    const dedupe = docNumber ? `oi:${docNumber}` : `cn:${str(raw.id)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const total = amount(raw.total);
    if (Math.abs(total) < 0.005) continue;
    rawMoves.push({
      id: str(raw.id) || dedupe,
      date: isoDate(raw.issued_at ?? raw.issuedAt ?? raw.created_at ?? raw.createdAt),
      type: 'credit_note',
      reference: docNumber,
      description: describe('credit_note', labels),
      debit: party === 'supplier' ? total : 0,
      credit: party === 'customer' ? total : 0,
    });
  }

  for (const raw of debitNotes) {
    const docNumber = str(raw.document_number ?? raw.documentNumber);
    const dedupe = docNumber ? `oi:${docNumber}` : `dn:${str(raw.id)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const total = amount(raw.total);
    if (Math.abs(total) < 0.005) continue;
    rawMoves.push({
      id: str(raw.id) || dedupe,
      date: isoDate(raw.issued_at ?? raw.issuedAt ?? raw.created_at ?? raw.createdAt),
      type: 'debit_note',
      reference: docNumber,
      description: describe('debit_note', labels),
      debit: party === 'customer' ? total : 0,
      credit: party === 'supplier' ? total : 0,
    });
  }

  for (const raw of purchases) {
    const status = str(raw.status).toLowerCase();
    if (status === 'voided' || status === 'cancelled' || status === 'canceled' || status === 'draft') continue;
    const docNumber = str(raw.invoice_number ?? raw.invoiceNumber);
    const docId = str(raw.id);
    const dedupe = docNumber ? `oi:${docNumber}` : `fc:${docId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const total = amount(raw.total);
    if (Math.abs(total) < 0.005) continue;
    rawMoves.push({
      id: docId || dedupe,
      date: isoDate(raw.date ?? raw.created_at ?? raw.createdAt),
      type: 'purchase',
      reference: docNumber,
      description: describe('purchase', labels),
      debit: 0,
      credit: total,
    });
  }

  rawMoves.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.reference.localeCompare(b.reference);
  });

  let openingBalance = 0;
  const periodMoves: Omit<AccountStatementMovement, 'balance'>[] = [];
  for (const move of rawMoves) {
    if (move.date && move.date < dateFrom) {
      openingBalance += signedDelta(party, move.debit, move.credit);
      continue;
    }
    if (move.date && move.date > dateTo) continue;
    periodMoves.push(move);
  }

  let running = openingBalance;
  const lines: AccountStatementMovement[] = [{
    id: 'opening',
    date: dateFrom,
    type: 'opening',
    reference: '',
    description: labels.openingBalance,
    debit: 0,
    credit: 0,
    balance: openingBalance,
  }];

  let periodDebit = 0;
  let periodCredit = 0;
  for (const move of periodMoves) {
    running += signedDelta(party, move.debit, move.credit);
    periodDebit += move.debit;
    periodCredit += move.credit;
    lines.push({ ...move, balance: running });
  }

  return {
    openingBalance,
    lines,
    periodDebit,
    periodCredit,
    closingBalance: running,
  };
}
