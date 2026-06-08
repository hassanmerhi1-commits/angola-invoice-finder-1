import { useCallback, useEffect, useState } from 'react';
import { getApiUrlAsync, isDemoMode, isThinClientMode } from '@/lib/api/config';
import { electronAwareJsonRequest } from '@/lib/electronHttp';
import { isOfflineModeActive, setOfflineModeActive } from '@/lib/offlineAuth';
import { getOfflinePendingCount } from '@/lib/sync/offlineSales';

type OfflineBannerState = {
  visible: boolean;
  pendingCount: number;
  serverReachable: boolean | null;
};

async function pingCityServer(): Promise<boolean> {
  try {
    const apiUrl = await getApiUrlAsync({ waitForPortMs: 2000 });
    const origin = new URL(apiUrl).origin;
    const res = await electronAwareJsonRequest(`${origin}/api/health`, { timeoutMs: 4000 });
    return res.ok && !!(res.json as { ok?: boolean })?.ok;
  } catch {
    return false;
  }
}

export function useOfflineBanner(): OfflineBannerState {
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [offlineLogin, setOfflineLogin] = useState(() => isOfflineModeActive());

  const refresh = useCallback(async () => {
    setOfflineLogin(isOfflineModeActive());
    setPendingCount(await getOfflinePendingCount());

    if (!isThinClientMode() && !isOfflineModeActive()) {
      setServerReachable(null);
      return;
    }

    const reachable = await pingCityServer();
    setServerReachable(reachable);
    if (reachable && isOfflineModeActive()) {
      setOfflineModeActive(false);
      setOfflineLogin(false);
    }
  }, []);

  useEffect(() => {
    if (isDemoMode()) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const thinClient = isThinClientMode();
  const visible =
    !isDemoMode()
    && (offlineLogin || (thinClient && serverReachable === false));

  return { visible, pendingCount, serverReachable };
}
