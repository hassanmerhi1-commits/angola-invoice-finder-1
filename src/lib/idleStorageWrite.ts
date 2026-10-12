/**
 * Coalesced, idle-time Web Storage writes.
 *
 * Grid / list caches are multi-MB JSON. Stringifying them synchronously after every socket
 * refresh froze the UI on busy days; here the latest value per key is written once, when the
 * browser is idle, and pending writes are flushed before the page unloads.
 */
type PendingWrite = { storage: Storage; key: string; build: () => string | null };

const pending = new Map<string, PendingWrite>();
let scheduled = false;

type IdleDeadlineLike = { timeRemaining: () => number; didTimeout?: boolean };

function pendingId(storage: Storage, key: string): string {
  return `${storage === localStorage ? 'l' : 's'}|${key}`;
}

function runWrite(write: PendingWrite): void {
  try {
    const raw = write.build();
    if (raw == null) write.storage.removeItem(write.key);
    else write.storage.setItem(write.key, raw);
  } catch {
    /* quota / private mode */
  }
}

function flush(deadline?: IdleDeadlineLike): void {
  scheduled = false;
  for (const [id, write] of pending) {
    if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 4) {
      schedule();
      return;
    }
    pending.delete(id);
    runWrite(write);
  }
}

function schedule(): void {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;
  const ric = (window as Window & {
    requestIdleCallback?: (cb: (d: IdleDeadlineLike) => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') ric(flush, { timeout: 3000 });
  else window.setTimeout(() => flush(), 400);
}

/** Queue `build()` → storage.setItem(key) (null removes). Later calls for the same key win. */
export function scheduleStorageWrite(storage: Storage, key: string, build: () => string | null): void {
  pending.set(pendingId(storage, key), { storage, key, build });
  schedule();
}

export function cancelStorageWrite(storage: Storage, key: string): void {
  pending.delete(pendingId(storage, key));
}

export function flushStorageWrites(): void {
  flush();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStorageWrites);
  window.addEventListener('beforeunload', flushStorageWrites);
}

/** Rough JSON size of a large array from a sample, so oversized payloads skip stringify. */
export function estimateJsonChars(value: unknown): number {
  if (!Array.isArray(value) || value.length <= 40) return 0;
  try {
    const sample = JSON.stringify(value.slice(0, 20));
    return Math.ceil((sample.length / 20) * value.length);
  } catch {
    return 0;
  }
}
