import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrlAsync, isDemoMode, isThinClientMode } from '@/lib/api/config';
import { electronAwareJsonRequest } from '@/lib/electronHttp';
import { isOfflineModeActive, setOfflineModeActive } from '@/lib/offlineAuth';
import { getOfflinePendingCount } from '@/lib/sync/offlineSales';
import { setLanServerReachable } from '@/lib/lanReachability';

type OfflineBannerState = {
  visible: boolean;
  pendingCount: number;
  serverReachable: boolean | null;
};

// A single dropped/slow LAN ping shouldn't flip the whole UI to "offline" and
// back. Require this many consecutive failures before declaring the server
// unreachable; recovery is immediate on the first successful ping.
const OFFLINE_FAIL_THRESHOLD = 2;

async function pingCityServer(): Promise<boolean> {
  try {
    const apiUrl = await getApiUrlAsync({ waitForPortMs: 2000 });
    const origin = new URL(apiUrl).origin;
    // Generous timeout so normal Wi-Fi latency / a momentarily busy server
    // doesn't read as an outage.
    const res = await electronAwareJsonRequest(`${origin}/api/health`, { timeoutMs: 8000 });
    return res.ok && !!(res.json as { ok?: boolean })?.ok;
  } catch {
    return false;
  }
}

export function useOfflineBanner(): OfflineBannerState {
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [offlineLogin, setOfflineLogin] = useState(() => isOfflineModeActive());
  const failStreak = useRef(0);

  const refresh = useCallback(async () => {
    setOfflineLogin(isOfflineModeActive());
    setPendingCount(await getOfflinePendingCount());

    if (!isThinClientMode() && !isOfflineModeActive()) {
      failStreak.current = 0;
      setServerReachable(null);
      setLanServerReachable(null);
      return;
    }

    const reachable = await pingCityServer();
    if (reachable) {
      failStreak.current = 0;
      setServerReachable(true);
      setLanServerReachable(true);
      if (isOfflineModeActive()) {
        setOfflineModeActive(false);
        setOfflineLogin(false);
      }
      return;
    }

    // Only surface "offline" after repeated failures to avoid transient flapping.
    failStreak.current += 1;
    if (failStreak.current >= OFFLINE_FAIL_THRESHOLD) {
      setServerReachable(false);
      setLanServerReachable(false);
      // Mark offline so sales/other writes queue immediately instead of waiting on
      // a full network timeout each time. Cleared automatically on the next good ping.
      if (isThinClientMode() && !isOfflineModeActive()) {
        setOfflineModeActive(true);
        setOfflineLogin(true);
      }
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
