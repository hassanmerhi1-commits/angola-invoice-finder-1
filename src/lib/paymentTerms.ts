import { addDays, format, isValid, parseISO } from 'date-fns';

export function getPaymentTermDays(terms: string): number {
  switch (terms) {
    case 'immediate':
      return 0;
    case '15_days':
      return 15;
    case '30_days':
      return 30;
    case '60_days':
      return 60;
    case '90_days':
      return 90;
    default:
      return 30;
  }
}

/** Normalize API/SQLite due dates (ISO, dd-MM-yyyy, dd/MM/yyyy). */
export function normalizeDueDateString(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }

  try {
    const parsed = parseISO(s);
    if (isValid(parsed)) {
      return format(parsed, 'yyyy-MM-dd');
    }
  } catch {
    /* fall through */
  }

  const asDate = new Date(s);
  if (isValid(asDate)) {
    return format(asDate, 'yyyy-MM-dd');
  }

  return null;
}

/** Effective due date for checklist (stored due_date, else document_date + supplier terms). */
export function resolveOpenItemDueDate(
  rawDue: unknown,
  documentDate: string,
  paymentTerms?: string | null,
): string | null {
  const normalized = normalizeDueDateString(rawDue);
  if (normalized) return normalized;

  const doc = normalizeDueDateString(documentDate) || String(documentDate || '').slice(0, 10);
  if (!doc || !paymentTerms) return null;

  try {
    return format(addDays(parseISO(doc), getPaymentTermDays(String(paymentTerms))), 'yyyy-MM-dd');
  } catch {
    return null;
  }
}
