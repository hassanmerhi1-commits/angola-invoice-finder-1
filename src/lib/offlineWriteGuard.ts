import { isOfflineModeActive } from '@/lib/offlineAuth';

/** Throws when the session is offline (no JWT) and a server write is required. */
export function assertOnlineForWrite(actionLabel = 'this action'): void {
  if (!isOfflineModeActive()) return;
  throw new Error(
    `Cannot ${actionLabel} while offline. Connect to the server and sign in again.`,
  );
}

export function isOfflineWriteBlocked(): boolean {
  return isOfflineModeActive();
}
