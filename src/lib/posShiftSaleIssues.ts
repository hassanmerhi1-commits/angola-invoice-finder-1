export type PosShiftIssueKind = 'checkout' | 'print' | 'caixa';

export interface PosShiftIssue {
  id: string;
  kind: PosShiftIssueKind;
  message: string;
  at: string;
  saleId?: string;
  invoiceNumber?: string;
}

const ISSUES_PREFIX = 'nexor:pos-shift-issues:v1:';

function storageKey(branchId: string, sessionId: string): string {
  return `${ISSUES_PREFIX}${branchId}:${sessionId}`;
}

export function readShiftIssues(branchId: string | undefined, sessionId: string | undefined): PosShiftIssue[] {
  if (!branchId || !sessionId) return [];
  try {
    const raw = localStorage.getItem(storageKey(branchId, sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PosShiftIssue[] : [];
  } catch {
    return [];
  }
}

function writeShiftIssues(branchId: string, sessionId: string, issues: PosShiftIssue[]): void {
  localStorage.setItem(storageKey(branchId, sessionId), JSON.stringify(issues));
}

export function appendShiftIssue(
  branchId: string,
  sessionId: string,
  issue: Omit<PosShiftIssue, 'id' | 'at'> & { at?: string; id?: string },
): PosShiftIssue {
  const row: PosShiftIssue = {
    id: issue.id || `issue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: issue.at || new Date().toISOString(),
    kind: issue.kind,
    message: issue.message,
    saleId: issue.saleId,
    invoiceNumber: issue.invoiceNumber,
  };
  const prev = readShiftIssues(branchId, sessionId);
  writeShiftIssues(branchId, sessionId, [row, ...prev].slice(0, 100));
  return row;
}

export function clearSaleIssueKind(
  branchId: string,
  sessionId: string,
  saleId: string,
  kind: PosShiftIssueKind,
): void {
  const next = readShiftIssues(branchId, sessionId).filter(
    (row) => !(row.saleId === saleId && row.kind === kind),
  );
  writeShiftIssues(branchId, sessionId, next);
}

export type PosShiftSaleStatus =
  | 'completed'
  | 'voided'
  | 'pending'
  | 'print_error'
  | 'caixa_error'
  | 'agt_error';

export function resolveShiftSaleStatus(
  sale: { id: string; invoiceNumber?: string; status?: string; agtStatus?: string },
  issues: PosShiftIssue[],
): PosShiftSaleStatus {
  if (sale.status === 'voided') return 'voided';
  if (sale.status === 'pending') return 'pending';
  if (sale.agtStatus === 'rejected') return 'agt_error';

  const related = issues.filter(
    (row) =>
      (row.saleId && row.saleId === sale.id)
      || (row.invoiceNumber && sale.invoiceNumber && row.invoiceNumber === sale.invoiceNumber),
  );
  if (related.some((row) => row.kind === 'print')) return 'print_error';
  if (related.some((row) => row.kind === 'caixa')) return 'caixa_error';
  return sale.status === 'completed' ? 'completed' : 'pending';
}

export function listCheckoutFailures(
  branchId: string | undefined,
  sessionId: string | undefined,
): PosShiftIssue[] {
  return readShiftIssues(branchId, sessionId).filter((row) => row.kind === 'checkout');
}
