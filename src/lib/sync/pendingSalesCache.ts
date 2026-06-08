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

export function savePendingSaleCache(sale: PendingSaleRow): void {
  const id = String(sale.id || sale.clientRequestId || sale.client_request_id || '').trim();
  if (!id) return;
  const rows = readAll().filter(
    (r) => String(r.id || r.clientRequestId || r.client_request_id || '') !== id,
  );
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
  writeAll(
    readAll().filter(
      (r) =>
        String(r.id || '') !== key
        && String(r.clientRequestId || r.client_request_id || '') !== key,
    ),
  );
}

function saleRowScore(row: PendingSaleRow): number {
  let score = 0;
  if (Array.isArray(row.items) && row.items.length > 0) score += 20;
  if (row.pendingSync || row.pending_sync) score += 10;
  if (row.invoice_number || row.invoiceNumber) score += 5;
  if (row.created_at || row.createdAt) score += 1;
  return score;
}

/** Merge server + local/pending rows; prefer richer local rows until server catches up. */
export function mergeSaleRows(serverRows: PendingSaleRow[], extraRows: PendingSaleRow[]): PendingSaleRow[] {
  const byKey = new Map<string, PendingSaleRow>();
  const keyFor = (row: PendingSaleRow) => {
    const id = String(row.id || '').trim();
    const crid = String(row.client_request_id || row.clientRequestId || '').trim();
    const inv = String(row.invoice_number || row.invoiceNumber || '').trim();
    return id || crid || inv;
  };

  for (const row of [...extraRows, ...serverRows]) {
    const key = keyFor(row);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || saleRowScore(row) >= saleRowScore(prev)) {
      byKey.set(key, row);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const ta = new Date(String(a.created_at || a.createdAt || 0)).getTime();
    const tb = new Date(String(b.created_at || b.createdAt || 0)).getTime();
    return tb - ta;
  });
}
