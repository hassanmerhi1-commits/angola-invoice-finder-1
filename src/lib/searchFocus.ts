/** HashRouter sometimes leaves `location.search` empty — recover `?…` from the hash. */
export function readAppSearchParams(locationSearch: string): URLSearchParams {
  let q = String(locationSearch || '');
  if ((!q || q === '?') && typeof window !== 'undefined') {
    const hash = window.location.hash || '';
    const qi = hash.indexOf('?');
    if (qi >= 0) q = hash.slice(qi);
  }
  if (q.startsWith('?')) q = q.slice(1);
  return new URLSearchParams(q);
}

export type NexorSearchFocus =
  | { kind: 'product'; productId: string; sku?: string; name?: string }
  | { kind: 'client'; clientId: string }
  | { kind: 'supplier'; supplierId: string }
  | { kind: 'sale'; invoiceId: string; q?: string }
  | { kind: 'purchase'; invoiceId: string; q?: string }
  | { kind: 'purchaseOrder'; orderId: string; q?: string }
  | { kind: 'salesOrder'; orderId: string }
  | { kind: 'proforma'; proformaId: string }
  | { kind: 'creditNote'; creditNoteId: string }
  | { kind: 'debitNote'; debitNoteId: string }
  | { kind: 'transport'; transportId: string }
  | { kind: 'expense'; expenseId: string }
  | { kind: 'payment'; paymentId: string; q?: string; type?: string }
  | { kind: 'journal'; journalId: string; q?: string }
  | { kind: 'account'; accountId: string; code?: string }
  | { kind: 'bankAccount'; bankAccountId: string }
  | { kind: 'stockTransfer'; transferId: string }
  | { kind: 'importOrder'; importOrderId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'branch'; branchId: string }
  | { kind: 'category'; categoryId: string }
  | { kind: 'caixa'; caixaId: string }
  | { kind: 'openItem'; openItemId: string; q?: string; entityType?: string };

export function readFocusId(
  location: { search?: string; state?: unknown },
  queryKey: string,
  kind: NexorSearchFocus['kind'],
  stateKey: string,
): string {
  const fromQuery = readAppSearchParams(location.search || '').get(queryKey)?.trim() || '';
  if (fromQuery) return fromQuery;
  const focus = readNexorSearchFocus(location.state);
  if (!focus || focus.kind !== kind) return '';
  return String((focus as Record<string, unknown>)[stateKey] || '').trim();
}

export function searchHref(path: string, params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) p.set(k, v);
  });
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

export function readNexorSearchFocus(state: unknown): NexorSearchFocus | null {
  const focus = (state as { nexorSearchFocus?: NexorSearchFocus } | null | undefined)?.nexorSearchFocus;
  if (!focus || typeof focus !== 'object' || !('kind' in focus)) return null;
  return focus;
}

export function splitAppHref(href: string): { pathname: string; search: string } {
  const raw = String(href || '');
  const qi = raw.indexOf('?');
  if (qi < 0) return { pathname: raw || '/', search: '' };
  return { pathname: raw.slice(0, qi) || '/', search: raw.slice(qi) };
}

export function scrollToNexorRow(id: string) {
  const target = String(id || '').trim();
  if (!target) return;
  window.setTimeout(() => {
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(target)
      : target.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const el = document.querySelector(`[data-nexor-id="${escaped}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, 80);
}

export function productSearchHref(id: string, sku?: string, name?: string) {
  const p = new URLSearchParams();
  p.set('productId', id);
  if (sku) p.set('sku', sku);
  if (name) p.set('name', name);
  return `/inventory?${p.toString()}`;
}

export function clientSearchHref(id: string) {
  return `/clients?clientId=${encodeURIComponent(id)}`;
}

export function saleSearchHref(id: string, invoiceNumber?: string) {
  const p = new URLSearchParams();
  p.set('invoiceId', id);
  if (invoiceNumber) p.set('q', invoiceNumber);
  return `/invoices?${p.toString()}`;
}

export function purchaseSearchHref(id: string, invoiceNumber?: string) {
  const p = new URLSearchParams();
  p.set('invoiceId', id);
  if (invoiceNumber) p.set('q', invoiceNumber);
  return `/purchase-invoices?${p.toString()}`;
}

export function supplierSearchHref(id: string) {
  return searchHref('/suppliers', { supplierId: id });
}

export function purchaseOrderSearchHref(id: string, orderNumber?: string) {
  return searchHref('/purchase-orders', { orderId: id, q: orderNumber });
}

export function salesOrderSearchHref(id: string) {
  return searchHref('/sales-orders', { orderId: id });
}

export function proformaSearchHref(id: string) {
  return searchHref('/proforma', { proformaId: id });
}

export function creditNoteSearchHref(id: string) {
  return searchHref('/fiscal-documents', { creditNoteId: id });
}

export function debitNoteSearchHref(id: string) {
  return searchHref('/fiscal-documents', { debitNoteId: id });
}

export function transportSearchHref(id: string) {
  return searchHref('/fiscal-documents', { transportId: id });
}

export function expenseSearchHref(id: string) {
  return searchHref('/expenses', { expenseId: id });
}

export function paymentSearchHref(id: string, paymentNumber?: string, type?: string) {
  return searchHref('/payments', { paymentId: id, q: paymentNumber, type });
}

export function journalSearchHref(id: string, entryNumber?: string) {
  return searchHref('/journals', { journalId: id, q: entryNumber });
}

export function accountSearchHref(id: string, code?: string) {
  return searchHref('/chart-of-accounts', { accountId: id, code });
}

export function bankAccountSearchHref(id: string) {
  return searchHref('/bank-accounts', { bankAccountId: id });
}

export function stockTransferSearchHref(id: string) {
  return searchHref('/stock-transfer', { transferId: id });
}

export function importOrderSearchHref(id: string) {
  return searchHref('/import', { importOrderId: id });
}

export function userSearchHref(id: string) {
  return searchHref('/users', { userId: id });
}

export function branchSearchHref(id: string) {
  return searchHref('/branches', { branchId: id });
}

export function categorySearchHref(id: string) {
  return searchHref('/categories', { categoryId: id });
}

export function caixaSearchHref(id: string) {
  return searchHref('/caixa', { caixaId: id });
}

export function openItemSearchHref(id: string, entityType?: string, q?: string) {
  const path = entityType === 'supplier' ? '/payables' : '/receivables';
  return searchHref(path, { openItemId: id, q });
}

/** Digits only, leading zeros stripped — matches 1010-00030 / 101000030. */
function digitProductCodeForMatch(code: string): string {
  const digits = String(code || '').replace(/\D/g, '');
  if (!digits) return '';
  const trimmed = digits.replace(/^0+/, '');
  return trimmed || '0';
}

type SearchableProduct = { id: string; sku?: string; name?: string; barcode?: string };

/** Resolve a catalog/grid row from global-search ids (HQ merge may keep a different id per SKU). */
export function findProductForSearchFocus<T extends SearchableProduct>(
  products: T[],
  opts: { productId?: string; sku?: string; name?: string },
): T | undefined {
  const id = String(opts.productId || '').trim();
  const sku = String(opts.sku || '').trim().toLowerCase();
  const name = String(opts.name || '').trim().toLowerCase();
  const skuDigits = digitProductCodeForMatch(opts.sku || '');

  if (id) {
    const byId = products.find((p) => p.id === id);
    if (byId) return byId;
  }
  if (sku) {
    const exactSku = products.find((p) => String(p.sku || '').toLowerCase() === sku);
    if (exactSku) return exactSku;
    if (skuDigits) {
      const byDigits = products.find((p) => digitProductCodeForMatch(p.sku || '') === skuDigits);
      if (byDigits) return byDigits;
    }
    const skuContains = products.find((p) => String(p.sku || '').toLowerCase().includes(sku));
    if (skuContains) return skuContains;
    const barcode = products.find((p) => String(p.barcode || '').toLowerCase() === sku
      || String(p.barcode || '').toLowerCase().includes(sku));
    if (barcode) return barcode;
  }
  if (name) {
    const exactName = products.find((p) => String(p.name || '').toLowerCase() === name);
    if (exactName) return exactName;
    const nameContains = products.find((p) => String(p.name || '').toLowerCase().includes(name));
    if (nameContains) return nameContains;
  }
  return undefined;
}
