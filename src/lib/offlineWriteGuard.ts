import { isOfflineModeActive } from '@/lib/offlineAuth';
import { isLanLikelyDown } from '@/lib/lanReachability';

/**
 * Throws when a server write cannot proceed (offline login or known LAN outage).
 * Queueable actions (payments/stock) should enqueue instead of calling this.
 */
export function assertOnlineForWrite(actionLabel = 'this action'): void {
  if (!isOfflineModeActive() && !isLanLikelyDown()) return;
  throw new Error(
    `Cannot ${actionLabel} while the server is unreachable. `
    + `Reconnect to the network, wait for sync, then try again.`,
  );
}

export function isOfflineWriteBlocked(): boolean {
  return isOfflineModeActive() || isLanLikelyDown();
}

/** Prefer queueing over blocking when the shop has a sync outbox. */
export function canQueueOfflineWrites(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).electronAPI?.syncOutbox?.enqueue;
}
