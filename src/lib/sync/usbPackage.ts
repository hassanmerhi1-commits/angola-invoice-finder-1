/** USB / folder sneakernet packages. Stock on down-packages is POS snapshot only. */

export const USB_PACKAGE_VERSION = 1;

export type NexorUpEvent = {
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt?: string | null;
};

export type NexorUpPackage = {
  kind: 'nexor-up';
  version: number;
  fromBranchId?: string | null;
  toBranchId?: string | null;
  branchName?: string | null;
  generatedAt: string;
  appVersion?: string | null;
  dateRange?: { from: string; to: string };
  events: NexorUpEvent[];
  counts?: Record<string, number>;
  checksum: string;
};

export type StockSnapshotRow = {
  productId?: string;
  sku?: string;
  stock: number;
};

export type NexorDownPackage = {
  kind: 'nexor-down';
  version: number;
  stockSnapshotOnly: true;
  fromBranchId?: string | null;
  toBranchId?: string | null;
  branchName?: string | null;
  generatedAt: string;
  appVersion?: string | null;
  products: Array<Record<string, unknown>>;
  clients: Array<Record<string, unknown>>;
  stockSnapshot: StockSnapshotRow[];
  counts?: Record<string, number>;
  checksum: string;
};

export type NexorUsbPackage = NexorUpPackage | NexorDownPackage;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function checksumOf(obj: unknown): string {
  return fnv1aHex(stableStringify(obj));
}

export function withChecksum<T extends Record<string, unknown>>(body: T): T & { checksum: string } {
  const { checksum: _ignored, ...rest } = body as T & { checksum?: string };
  return { ...(rest as T), checksum: checksumOf(rest) };
}

export function verifyChecksum(pkg: { checksum?: string } | null | undefined): { ok: boolean; error?: string } {
  if (!pkg || typeof pkg !== 'object') return { ok: false, error: 'invalid package' };
  const { checksum, ...rest } = pkg;
  if (!checksum || checksum !== checksumOf(rest)) {
    return { ok: false, error: 'checksum mismatch' };
  }
  return { ok: true };
}

export function buildUpPackage(opts: {
  events: NexorUpEvent[];
  fromBranchId?: string | null;
  branchName?: string | null;
  dateRange?: { from: string; to: string };
  appVersion?: string | null;
}): NexorUpPackage {
  const events = opts.events || [];
  const typeCounts: Record<string, number> = {};
  for (const ev of events) {
    const t = ev.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  return withChecksum({
    kind: 'nexor-up' as const,
    version: USB_PACKAGE_VERSION,
    fromBranchId: opts.fromBranchId || null,
    toBranchId: null,
    branchName: opts.branchName || null,
    generatedAt: new Date().toISOString(),
    appVersion: opts.appVersion || null,
    dateRange: opts.dateRange,
    events,
    counts: { events: events.length, ...typeCounts },
  });
}

export function parseUsbPackage(raw: string): NexorUsbPackage {
  const pkg = JSON.parse(raw) as NexorUsbPackage;
  const check = verifyChecksum(pkg);
  if (!check.ok) throw new Error(check.error || 'checksum mismatch');
  if (pkg.kind !== 'nexor-up' && pkg.kind !== 'nexor-down') {
    throw new Error('unknown package kind');
  }
  if (pkg.kind === 'nexor-up' && !Array.isArray(pkg.events)) {
    throw new Error('events array required');
  }
  if (pkg.kind === 'nexor-down' && pkg.stockSnapshotOnly !== true) {
    throw new Error('down package must be a POS stock snapshot (stockSnapshotOnly)');
  }
  return pkg;
}

export function countUpEvents(pkg: NexorUpPackage): Record<string, number> {
  const counts: Record<string, number> = {
    sales: 0,
    payments: 0,
    purchases: 0,
    movements: 0,
    caixa: 0,
    other: 0,
  };
  for (const ev of pkg.events || []) {
    if (ev.type === 'sale.created') counts.sales += 1;
    else if (ev.type === 'payment.created') counts.payments += 1;
    else if (ev.type === 'purchase_invoice.created') counts.purchases += 1;
    else if (ev.type === 'stock_movement') counts.movements += 1;
    else if (ev.type === 'caixa.close') counts.caixa += 1;
    else counts.other += 1;
  }
  return counts;
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function stockByProduct(pkg: NexorDownPackage): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of pkg.stockSnapshot || []) {
    const id = String(row.productId || '').trim();
    if (id) map.set(id, Number(row.stock) || 0);
    const sku = String(row.sku || '').trim();
    if (sku) map.set(`sku:${sku}`, Number(row.stock) || 0);
  }
  return map;
}

/** Merge snapshot qty onto products. Never posts stock movements. */
export function productsWithSnapshotStock(pkg: NexorDownPackage): Array<Record<string, unknown>> {
  const snap = stockByProduct(pkg);
  return (pkg.products || []).map((p) => {
    const id = String(p.id || '');
    const sku = String(p.sku || '');
    const stock = snap.get(id) ?? snap.get(`sku:${sku}`) ?? (Number(p.stock) || 0);
    return { ...p, stock };
  });
}
