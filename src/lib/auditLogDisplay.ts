export const AUDIT_TABLE_MODULE_MAP: Record<string, string> = {
  sales: 'invoices',
  proformas: 'fiscal',
  credit_notes: 'fiscal',
  debit_notes: 'fiscal',
  transport_documents: 'fiscal',
  saft: 'fiscal',
  users: 'system',
  agt: 'fiscal',
};

export function parseAuditJsonField(val: unknown): Record<string, unknown> | undefined {
  if (val == null || val === '') return undefined;
  if (typeof val === 'object') return val as Record<string, unknown>;
  try {
    return JSON.parse(String(val)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export interface AuditLogRow {
  id: string;
  action: string;
  module: string;
  tableName: string;
  description: string;
  userName: string;
  userId: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

export function mapAuditLogRow(row: Record<string, unknown>): AuditLogRow {
  const tableName = String(row.table_name || 'system');
  const metadata = parseAuditJsonField(row.metadata);
  const newValues = parseAuditJsonField(row.new_values);
  return {
    id: String(row.id),
    action: String(row.action || 'update'),
    module: AUDIT_TABLE_MODULE_MAP[tableName] || tableName,
    tableName,
    description: String(row.description || `${row.action} ${tableName}`),
    userName: String(row.user_name || row.userName || 'System'),
    userId: String(row.user_id || row.userId || ''),
    createdAt: String(row.created_at || row.timestamp || new Date().toISOString()),
    details: metadata || newValues,
  };
}

export type AuditDetailRow = { label: string; value: string };

export type AuditDetailFormatLabels = {
  fieldInvoiceNumber: string;
  fieldInvoiceType: string;
  fieldPaymentMethod: string;
  fieldTotal: string;
  fieldItemCount: string;
  fieldProformaNumber: string;
  fieldProformaId: string;
  fieldEmpty: string;
  paymentCash: string;
  paymentCard: string;
  paymentTransfer: string;
  paymentCheque: string;
  paymentMixed: string;
  paymentCredit: string;
};

const DETAIL_FIELD_ORDER = [
  'invoiceNumber',
  'invoice_number',
  'invoiceType',
  'invoice_type',
  'paymentMethod',
  'payment_method',
  'total',
  'items',
  'parentProformaNumber',
  'parent_proforma_number',
  'parentProformaId',
  'parent_proforma_id',
] as const;

const FIELD_LABEL_KEYS: Record<string, keyof AuditDetailFormatLabels> = {
  invoiceNumber: 'fieldInvoiceNumber',
  invoice_number: 'fieldInvoiceNumber',
  invoiceType: 'fieldInvoiceType',
  invoice_type: 'fieldInvoiceType',
  paymentMethod: 'fieldPaymentMethod',
  payment_method: 'fieldPaymentMethod',
  total: 'fieldTotal',
  items: 'fieldItemCount',
  parentProformaNumber: 'fieldProformaNumber',
  parent_proforma_number: 'fieldProformaNumber',
  parentProformaId: 'fieldProformaId',
  parent_proforma_id: 'fieldProformaId',
};

function formatPaymentMethod(raw: unknown, labels: AuditDetailFormatLabels): string {
  const m = String(raw || '').toLowerCase();
  const map: Record<string, string> = {
    cash: labels.paymentCash,
    card: labels.paymentCard,
    transfer: labels.paymentTransfer,
    cheque: labels.paymentCheque,
    mixed: labels.paymentMixed,
    credit: labels.paymentCredit,
  };
  return map[m] || String(raw ?? labels.fieldEmpty);
}

function formatDetailValue(
  key: string,
  raw: unknown,
  labels: AuditDetailFormatLabels,
  locale: string,
): string {
  if (raw == null || raw === '') return labels.fieldEmpty;
  if (key === 'paymentMethod' || key === 'payment_method') {
    return formatPaymentMethod(raw, labels);
  }
  if (key === 'total') {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AOA`;
    }
  }
  if (key === 'items') {
    const n = Number(raw);
    return Number.isFinite(n) ? String(Math.trunc(n)) : String(raw);
  }
  return String(raw);
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Turn audit `new_values` / metadata into labelled rows for the detail dialog. */
export function buildAuditDetailRows(
  details: Record<string, unknown> | undefined,
  labels: AuditDetailFormatLabels,
  locale: string,
): AuditDetailRow[] {
  if (!details || typeof details !== 'object') return [];

  const used = new Set<string>();
  const rows: AuditDetailRow[] = [];

  for (const key of DETAIL_FIELD_ORDER) {
    if (!(key in details)) continue;
    const labelKey = FIELD_LABEL_KEYS[key];
    rows.push({
      label: labelKey ? labels[labelKey] : humanizeKey(key),
      value: formatDetailValue(key, details[key], labels, locale),
    });
    used.add(key);
  }

  for (const [key, raw] of Object.entries(details)) {
    if (used.has(key)) continue;
    rows.push({
      label: humanizeKey(key),
      value: formatDetailValue(key, raw, labels, locale),
    });
  }

  return rows;
}
