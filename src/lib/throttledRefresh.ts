/**
 * Trailing throttle for socket-driven reloads. Every till's sale reaches every open client, so
 * a burst of events runs `run` once, and never more often than `minGapMs`.
 */
export function createThrottledRefresh(run: () => void, minGapMs: number, minDelayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRunAt = 0;
  return {
    trigger() {
      if (timer) return;
      const wait = Math.max(minDelayMs, minGapMs - (Date.now() - lastRunAt));
      timer = setTimeout(() => {
        timer = null;
        lastRunAt = Date.now();
        run();
      }, wait);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
