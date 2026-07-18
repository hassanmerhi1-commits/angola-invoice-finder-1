/**
 * Shared LAN reachability signal for thin clients.
 * Updated by the offline banner ping; read by write paths / outbox short-circuit.
 */
import { isOfflineModeActive } from '@/lib/offlineAuth';

const REACHABLE_KEY = 'nexor_lan_reachable';

export function setLanServerReachable(reachable: boolean | null): void {
  try {
    if (reachable === null) {
      localStorage.removeItem(REACHABLE_KEY);
      return;
    }
    localStorage.setItem(REACHABLE_KEY, reachable ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getLanServerReachable(): boolean | null {
  try {
    const v = localStorage.getItem(REACHABLE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return null;
}

/** True when offline mode is on or the banner last saw the city server down. */
export function isLanLikelyDown(): boolean {
  if (isOfflineModeActive()) return true;
  return getLanServerReachable() === false;
}
