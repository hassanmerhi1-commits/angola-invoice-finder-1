/**
 * Warm the main lazy route chunks after login / on nav hover so first open
 * does not wait on the network for the JS bundle.
 */

const PREFETCH_BY_PATH: Record<string, () => Promise<unknown>> = {
  '/': () => import('@/pages/Dashboard'),
  '/pos': () => import('@/pages/POS'),
  '/inventory': () => import('@/pages/Inventory'),
  '/purchase-invoices': () => import('@/pages/PurchaseInvoices'),
  '/chart-of-accounts': () => import('@/pages/ChartOfAccounts'),
  '/invoices': () => import('@/pages/Invoices'),
  '/suppliers': () => import('@/pages/Suppliers'),
  '/journals': () => import('@/pages/Journals'),
};

const warmed = new Set<string>();

export function prefetchRoute(path: string): void {
  const key = String(path || '').replace(/\/$/, '') || '/';
  const loader = PREFETCH_BY_PATH[key];
  if (!loader || warmed.has(key)) return;
  warmed.add(key);
  void loader().catch(() => {
    warmed.delete(key);
  });
}

/** Core screens most users open after login. */
export function prefetchCoreRoutes(): void {
  for (const path of [
    '/pos',
    '/inventory',
    '/purchase-invoices',
    '/chart-of-accounts',
    '/invoices',
  ]) {
    prefetchRoute(path);
  }
}
