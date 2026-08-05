const CACHE_KEY = 'nexor:pending-sales:v1';

type PendingSaleRow = Record<string, unknown>;

function readAll(): PendingSaleRow[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: PendingSaleRow[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

function rowString(row: PendingSaleRow, ...keys: string[]): string {
  for (const key of keys) {
    const val = String(row[key] ?? '').trim();
    if (val) return val;
  }
  return '';
}

function normalizedInvoice(row: PendingSaleRow): string {
  return rowString(row, 'invoice_number', 'invoiceNumber').toUpperCase();
}

/** True when two rows describe the same sale (offline stub vs server row). */
export function salesRowsMatch(a: PendingSaleRow, b: PendingSaleRow): boolean {
  const aId = rowString(a, 'id');
  const bId = rowString(b, 'id');
  const aCrid = rowString(a, 'client_request_id', 'clientRequestId');
  const bCrid = rowString(b, 'client_request_id', 'clientRequestId');
  const aInv = normalizedInvoice(a);
  const bInv = normalizedInvoice(b);

  if (aId && (aId === bId || aId === bCrid)) return true;
  if (aCrid && (aCrid === bId || aCrid === bCrid)) return true;
  if (aInv && aInv === bInv && !aInv.startsWith('OFF-') && !aInv.startsWith('LOCAL-')) return true;
  return false;
}

export function savePendingSaleCache(sale: PendingSaleRow): void {
  const id = rowString(sale, 'id', 'clientRequestId', 'client_request_id');
  if (!id) return;
  const rows = readAll().filter((r) => !salesRowsMatch(r, sale));
  rows.unshift({ ...sale, pendingSync: true, pending_sync: true });
  writeAll(rows.slice(0, 200));
}

export function readPendingSalesCache(branchId?: string): PendingSaleRow[] {
  const rows = readAll();
  if (!branchId) return rows;
  const key = String(branchId).trim();
  return rows.filter(
    (r) => String(r.branchId || r.branch_id || '').trim() === key,
  );
}

export function removePendingSaleFromCache(idOrRequestId: string): void {
  const key = String(idOrRequestId || '').trim();
  if (!key) return;
  const keyUpper = key.toUpperCase();
  writeAll(
    readAll().filter((r) => {
      const candidates = [
        rowString(r, 'id'),
        rowString(r, 'clientRequestId', 'client_request_id'),
        normalizedInvoice(r),
      ].filter(Boolean);
      return !candidates.some((c) => c === key || c.toUpperCase() === keyUpper);
    }),
  );
}

/** Drop pending stubs once the city server has the authoritative sale row. */
export function clearPendingSaleMatches(row: PendingSaleRow): void {
  const tokens = [
    rowString(row, 'id'),
    rowString(row, 'client_request_id', 'clientRequestId'),
    normalizedInvoice(row),
  ].filter(Boolean);
  for (const token of tokens) {
    removePendingSaleFromCache(token);
  }
}

/** Mark a pending offline stub as already thermally printed (city mark comes later). */
export function stampPendingSalePrinted(
  id?: string | null,
  clientRequestId?: string | null,
  documentNumber?: string | null,
): void {
  const tokens = [id, clientRequestId, documentNumber]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (tokens.length === 0) return;
  const tokenSet = new Set(tokens.map((t) => t.toUpperCase()));
  const rows = readAll();
  let changed = false;
  const next = rows.map((row) => {
    const candidates = [
      rowString(row, 'id'),
      rowString(row, 'clientRequestId', 'client_request_id'),
      normalizedInvoice(row),
    ].filter(Boolean);
    if (!candidates.some((c) => tokenSet.has(c.toUpperCase()))) return row;
    changed = true;
    return {
      ...row,
      alreadyPrinted: true,
      printedAt: row.printedAt || row.printed_at || new Date().toISOString(),
      printed_at: row.printed_at || row.printedAt || new Date().toISOString(),
    };
  });
  if (changed) writeAll(next);
}

export function prunePendingSalesCacheForServerRows(serverRows: PendingSaleRow[]): void {
  for (const row of serverRows) {
    clearPendingSaleMatches(row);
  }
}

function saleRowScore(row: PendingSaleRow): number {
  let score = 0;
  if (Array.isArray(row.items) && row.items.length > 0) score += 20;
  if (row.pendingSync || row.pending_sync) score -= 20;
  else score += 20;
  if (row.invoice_number || row.invoiceNumber) score += 5;
  if (row.created_at || row.createdAt) score += 1;
  return score;
}

/** Merge server + local/pending rows; one row per sale (invoice / client request id). */
export function mergeSaleRows(serverRows: PendingSaleRow[], extraRows: PendingSaleRow[]): PendingSaleRow[] {
  const merged: PendingSaleRow[] = [];

  for (const row of [...extraRows, ...serverRows]) {
    const idx = merged.findIndex((existing) => salesRowsMatch(existing, row));
    if (idx >= 0) {
      if (saleRowScore(row) >= saleRowScore(merged[idx])) {
        merged[idx] = row;
      }
    } else {
      merged.push(row);
    }
  }

  return merged.sort((a, b) => {
    const ta = new Date(String(a.created_at || a.createdAt || 0)).getTime();
    const tb = new Date(String(b.created_at || b.createdAt || 0)).getTime();
    return tb - ta;
  });
}
