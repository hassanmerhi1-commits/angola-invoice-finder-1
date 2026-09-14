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
  | { kind: 'sale'; invoiceId: string; q?: string }
  | { kind: 'purchase'; invoiceId: string; q?: string };

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
