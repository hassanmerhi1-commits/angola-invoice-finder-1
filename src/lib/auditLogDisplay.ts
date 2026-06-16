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
