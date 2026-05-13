import type { NavigateFunction } from 'react-router-dom';



/** Dedicated route — works reliably with HashRouter (real navigation, not same-path no-ops). */

export const PURCHASE_INVOICES_NEW_PATH = '/purchase-invoices/new';



/** Prefer router pathname; fall back to hash (Electron / HashRouter sometimes report pathname out of sync). */

export function resolvePurchasePathname(pathname: string): string {

  let p = pathname.replace(/\/+$/, '') || '/';

  if (typeof window === 'undefined') return p;

  try {

    const raw = window.location.hash.replace(/^#/, '');

    const seg = raw.split('?')[0] || '';

    if (seg && (seg === '/purchase-invoices' || seg.startsWith('/purchase-invoices/'))) {

      return seg.startsWith('/') ? seg : `/${seg}`;

    }

  } catch {

    /* ignore */

  }

  return p;

}



/** @deprecated Legacy event name */

export const NEXOR_PURCHASE_START_CREATE = 'nexor:purchase-start-create';



/** Legacy query flag — kept for old bookmarks / Electron deep links using `?nexorPiNew=` */

export const NEXOR_PURCHASE_NEW_QUERY_KEY = 'nexorPiNew';



/**

 * Same key as Electron `dom-ready` injection — keep in sync with `electron/main.cjs`.

 * Uses **localStorage**: shared across Electron `BrowserWindow`s.

 */

export const PURCHASE_CREATE_INTENT_STORAGE_KEY = 'nexor_pi_intent_create_v1';

export const PURCHASE_CREATE_INTENT_TTL_MS = 12000;



export function writePurchaseCreateIntent(): void {

  try {

    localStorage.setItem(PURCHASE_CREATE_INTENT_STORAGE_KEY, String(Date.now()));

  } catch {

    /* ignore */

  }

}



export function clearPurchaseCreateIntent(): void {

  try {

    localStorage.removeItem(PURCHASE_CREATE_INTENT_STORAGE_KEY);

  } catch {

    /* ignore */

  }

}



export function readPurchaseCreateIntentPending(): boolean {

  try {

    const raw = localStorage.getItem(PURCHASE_CREATE_INTENT_STORAGE_KEY);

    if (!raw) return false;

    const ts = parseInt(raw, 10);

    if (!Number.isFinite(ts) || Date.now() - ts > PURCHASE_CREATE_INTENT_TTL_MS) {

      localStorage.removeItem(PURCHASE_CREATE_INTENT_STORAGE_KEY);

      return false;

    }

    return true;

  } catch {

    return false;

  }

}



/**

 * Opens nova fatura via **`/purchase-invoices/new`** — the only approach that consistently

 * updates HashRouter state (toolbar callbacks + query hacks still failed for some users).

 */

export function navigateThenStartPurchaseCreate(navigate: NavigateFunction, pathname: string): void {
  const p = resolvePurchasePathname(pathname);
  const onPurchaseZone =
    p === '/purchase-invoices' ||
    p.startsWith('/purchase-invoices/');
  writePurchaseCreateIntent();
  const search = `?fresh=${Date.now()}`;
  const to = { pathname: PURCHASE_INVOICES_NEW_PATH, search };
  if (!onPurchaseZone) {
    navigate(to);
    return;
  }
  navigate(to, { replace: true });
}


