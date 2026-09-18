import { apiBaseFromWindowOrigin, getLanClientApiBaseFromStorage } from '@/lib/api/config';

export type TillUiSource = 'server' | 'local' | 'web';

export async function getTillUiSource(): Promise<TillUiSource> {
  if (typeof window === 'undefined' || !(window as any).electronAPI?.isElectron) return 'web';
  try {
    const result = await (window as any).electronAPI?.hotUpdate?.getSource?.();
    if (result?.source === 'server') return 'server';
  } catch {
    /* old Electron */
  }
  return 'local';
}

export function resolveCityServerUrlForTill(): string | null {
  return apiBaseFromWindowOrigin() || getLanClientApiBaseFromStorage();
}

/** Cashiers have no Settings. POS / login call this to pin the till to city /app. */
export async function switchTillToCityUi(): Promise<{
  ok: boolean;
  source?: string;
  error?: string;
}> {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI?.hotUpdate : null;
  if (!api?.setConfig) return { ok: false, error: 'not-electron' };

  let url = resolveCityServerUrlForTill();
  if (!url && api.getConfig) {
    try {
      const current = await api.getConfig();
      url = String(current?.config?.serverUrl || '').trim() || null;
    } catch {
      /* ignore */
    }
  }
  if (!url) return { ok: false, error: 'no-url' };

  try {
    await api.setConfig({ enabled: true, serverUrl: url, autoConnect: true });
    if (!api.reload) return { ok: true, source: 'server' };
    const reload = await api.reload();
    if (reload?.success) return { ok: true, source: reload.source || 'server' };
    return { ok: false, error: reload?.error || 'reload-failed', source: reload?.source };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'switch-failed' };
  }
}
