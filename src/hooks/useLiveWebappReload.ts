import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api/config';

const POLL_MS = 45_000;

function formIsBusy(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!document.querySelector('[data-nexor-dirty="1"]');
}

async function fetchWebappStamp(): Promise<string | null> {
  const base = getApiUrl().replace(/\/$/, '');
  const res = await fetch(`${base}/api/webapp-version`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as { stamp?: string | null };
  return data.stamp || null;
}

/** When the city server publishes a new /app, reload this window — no close/reopen. */
export function useLiveWebappReload() {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let known: string | null = null;

    const apply = (next: string) => {
      if (formIsBusy()) {
        setPending(true);
        return;
      }
      window.location.reload();
    };

    const poll = async () => {
      try {
        const stamp = await fetchWebappStamp();
        if (cancelled || !stamp) return;
        if (known == null) {
          known = stamp;
          return;
        }
        if (stamp !== known) apply(stamp);
      } catch {
        /* server offline */
      }
    };

    void poll();
    const timer = window.setInterval(() => { void poll(); }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return {
    pending,
    reloadNow: () => window.location.reload(),
  };
}
