import { newClientRequestId } from '@/lib/sync/offlineSales';

export function isOfflineFirstRole(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const role = localStorage.getItem('nexor_installation_role');
    if (role !== 'shop_client') return false;
    const flag = String(localStorage.getItem('nexor_offline_first') || '').toLowerCase();
    // Shop clients default to offline-first unless explicitly disabled.
    if (flag === 'false' || flag === '0' || flag === 'no') return false;
    if (flag !== 'true') {
      localStorage.setItem('nexor_offline_first', 'true');
    }
    return true;
  } catch {
    return false;
  }
}

export async function isOfflineFirstEnabled(): Promise<boolean> {
  if (!isOfflineFirstRole()) return false;
  const api = (window as any).electronAPI?.clientLocal;
  if (!api?.isEnabled) return isOfflineFirstRole();
  try {
    const r = await api.isEnabled();
    return !!r?.enabled;
  } catch {
    return isOfflineFirstRole();
  }
}

export async function saveSaleLocally(saleData: Record<string, unknown>): Promise<{
  ok: boolean;
  sale?: Record<string, unknown>;
  duplicate?: boolean;
  error?: string;
}> {
  const api = (window as any).electronAPI?.clientLocal;
  if (!api?.saveSale) {
    return { ok: false, error: 'Local client database not available' };
  }
  const body = {
    ...saleData,
    clientRequestId: (saleData.clientRequestId as string) || newClientRequestId(),
  };
  const result = await api.saveSale(body);
  if (!result?.ok) {
    return { ok: false, error: result?.error || 'Local save failed' };
  }
  return {
    ok: true,
    sale: result.sale,
    duplicate: result.duplicate,
  };
}

export async function syncProductsToLocalCache(products: Array<Record<string, unknown>>): Promise<void> {
  const api = (window as any).electronAPI?.clientLocal;
  if (!api?.syncProducts || !(await isOfflineFirstEnabled())) return;
  try {
    await api.syncProducts(products);
  } catch {
    /* non-fatal */
  }
}

/** Pull products from city server into local cache (shop client only). */
export async function pullMasterDataFromCity(branchId: string): Promise<{ ok: boolean; error?: string }> {
  const api = (window as any).electronAPI?.clientLocal;
  if (!api?.pullMasterData || !(await isOfflineFirstEnabled())) {
    return { ok: false, error: 'not available' };
  }
  try {
    const r = await api.pullMasterData(branchId);
    return r?.ok ? { ok: true } : { ok: false, error: r?.error };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

/** After online login: pull city catalog into local SQLite (non-blocking). */
export async function warmOfflineCatalog(branchId?: string): Promise<void> {
  if (!(await isOfflineFirstEnabled())) return;
  const id = String(branchId || '').trim();
  if (!id) return;
  try {
    await pullMasterDataFromCity(id);
  } catch {
    /* non-fatal */
  }
}

export async function getLocalPendingSyncItems(): Promise<Array<Record<string, unknown>>> {
  const api = (window as any).electronAPI?.clientLocal;
  if (!api?.listPending) return [];
  try {
    const r = await api.listPending();
    return r?.items || [];
  } catch {
    return [];
  }
}

/** Sales saved on the shop client SQLite (offline-first) — not on the city server until sync. */
export async function getLocalSales(branchId?: string): Promise<Array<Record<string, unknown>>> {
  if (!(await isOfflineFirstEnabled())) return [];
  const api = (window as any).electronAPI?.clientLocal;
  if (!api?.listSales) return [];
  try {
    const r = await api.listSales(branchId);
    return Array.isArray(r?.sales) ? r.sales : [];
  } catch {
    return [];
  }
}
