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
  /** Merged display bag (new values + metadata). Prefer oldValues/newValues for diffs. */
  details?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function mapAuditLogRow(row: Record<string, unknown>): AuditLogRow {
  const tableName = String(row.table_name || 'system');
  const metadata = parseAuditJsonField(row.metadata);
  const newValues = parseAuditJsonField(row.new_values ?? row.newValues);
  const oldValues = parseAuditJsonField(row.old_values ?? row.oldValues);
  // Never let metadata (often only ipAddress) hide new_values — that made product
  // updates look empty in Record details.
  const details = {
    ...(newValues || {}),
    ...(metadata || {}),
  };
  return {
    id: String(row.id),
    action: String(row.action || 'update'),
    module: AUDIT_TABLE_MODULE_MAP[tableName] || tableName,
    tableName,
    description: String(row.description || `${row.action} ${tableName}`),
    userName: String(row.user_name || row.userName || 'System'),
    userId: String(row.user_id || row.userId || ''),
    createdAt: String(row.created_at || row.timestamp || new Date().toISOString()),
    details: Object.keys(details).length ? details : undefined,
    oldValues,
    newValues,
    metadata,
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
  fieldName?: string;
  fieldSku?: string;
  fieldPrice?: string;
  fieldCost?: string;
  fieldStock?: string;
  fieldTaxRate?: string;
  fieldVatOverride?: string;
  fieldCategory?: string;
  fieldBranchId?: string;
  fieldIpAddress?: string;
  fieldWorkstation?: string;
  detailChanges?: string;
  detailSnapshot?: string;
  detailContext?: string;
  changeArrow?: string;
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
  'name',
  'sku',
  'price',
  'cost',
  'stock',
  'taxRate',
  'tax_rate',
  'vatOverride',
  'vat_override',
  'category',
  'branchId',
  'branch_id',
  'ipAddress',
  'workstationId',
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
  name: 'fieldName',
  sku: 'fieldSku',
  price: 'fieldPrice',
  cost: 'fieldCost',
  stock: 'fieldStock',
  taxRate: 'fieldTaxRate',
  tax_rate: 'fieldTaxRate',
  vatOverride: 'fieldVatOverride',
  vat_override: 'fieldVatOverride',
  category: 'fieldCategory',
  branchId: 'fieldBranchId',
  branch_id: 'fieldBranchId',
  ipAddress: 'fieldIpAddress',
  workstationId: 'fieldWorkstation',
};

const META_KEYS = new Set(['ipAddress', 'workstationId', 'workstation_id']);

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
  if (key === 'vatOverride' || key === 'vat_override' || typeof raw === 'boolean') {
    if (raw === true || raw === 1 || raw === '1' || raw === 't' || raw === 'true') return 'true';
    if (raw === false || raw === 0 || raw === '0' || raw === 'f' || raw === 'false') return 'false';
  }
  if (key === 'total' || key === 'price' || key === 'cost') {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AOA`;
    }
  }
  if (key === 'taxRate' || key === 'tax_rate') {
    const n = Number(raw);
    return Number.isFinite(n) ? `${n}%` : String(raw);
  }
  if (key === 'items' || key === 'stock') {
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : String(raw);
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelForKey(key: string, labels: AuditDetailFormatLabels): string {
  const labelKey = FIELD_LABEL_KEYS[key];
  const translated = labelKey ? labels[labelKey] : undefined;
  return translated || humanizeKey(key);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.0001;
  }
  return String(a) === String(b);
}

function orderedKeys(keys: string[]): string[] {
  const order = DETAIL_FIELD_ORDER as readonly string[];
  const ranked = keys.slice().sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return ranked;
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
    rows.push({
      label: labelForKey(key, labels),
      value: formatDetailValue(key, details[key], labels, locale),
    });
    used.add(key);
  }

  for (const [key, raw] of Object.entries(details)) {
    if (used.has(key)) continue;
    rows.push({
      label: labelForKey(key, labels),
      value: formatDetailValue(key, raw, labels, locale),
    });
  }

  return rows;
}

export type AuditDetailSections = {
  changes: AuditDetailRow[];
  snapshot: AuditDetailRow[];
  context: AuditDetailRow[];
  raw: Record<string, unknown>;
};

/**
 * Build Record-details sections: field changes (old → new), snapshot, and IP/context.
 */
export function buildAuditDetailSections(
  opts: {
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    details?: Record<string, unknown>;
  },
  labels: AuditDetailFormatLabels,
  locale: string,
): AuditDetailSections {
  const oldValues = opts.oldValues;
  const newValues = opts.newValues;
  const metadata = opts.metadata;
  const arrow = labels.changeArrow || '→';

  const changes: AuditDetailRow[] = [];
  if (oldValues && newValues) {
    const keys = orderedKeys([
      ...new Set([...Object.keys(oldValues), ...Object.keys(newValues)]),
    ].filter((k) => !META_KEYS.has(k)));
    for (const key of keys) {
      const before = oldValues[key];
      const after = newValues[key];
      if (valuesEqual(before, after)) continue;
      changes.push({
        label: labelForKey(key, labels),
        value: `${formatDetailValue(key, before, labels, locale)} ${arrow} ${formatDetailValue(key, after, labels, locale)}`,
      });
    }
  }

  const snapshotSource = newValues
    || (opts.details
      ? Object.fromEntries(Object.entries(opts.details).filter(([k]) => !META_KEYS.has(k)))
      : undefined);
  const snapshot = changes.length === 0
    ? buildAuditDetailRows(snapshotSource, labels, locale)
    : [];

  const contextSource = {
    ...(metadata || {}),
    ...Object.fromEntries(
      Object.entries(opts.details || {}).filter(([k]) => META_KEYS.has(k)),
    ),
  };
  const context = buildAuditDetailRows(
    Object.keys(contextSource).length ? contextSource : undefined,
    labels,
    locale,
  );

  const raw = {
    ...(oldValues ? { oldValues } : {}),
    ...(newValues ? { newValues } : {}),
    ...(metadata ? { metadata } : {}),
  };

  return { changes, snapshot, context, raw };
}
