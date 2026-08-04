import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureBranchCaixa,
  getCaixas,
  getOpenCaixaSessionForBranch,
  openCaixaSession,
  closeCaixaSession,
} from '@/lib/accountingStorage';
import { api } from '@/lib/api/client';
import { todayLocalDate, markPosCaixaClosed, getPosCaixaLastClosedAt } from '@/lib/posShiftSales';
import { branchIdsEquivalent } from '@/lib/branchAccess';
import { useTableRefreshListener } from '@/hooks/useRealtimeSyncBridge';
import type { Caixa, CaixaSession } from '@/types/accounting';

const POS_CAIXA_CACHE_PREFIX = 'nexor:pos-caixa-open:v1:';
const POS_CAIXA_DEBUG_KEY = 'nexor:caixa-debug-log';

function logCaixaDebug(event: string, detail?: Record<string, unknown>): void {
  const entry = { t: new Date().toISOString(), event, ...detail };
  try {
    console.info('[caixa]', event, detail || {});
    const raw = localStorage.getItem(POS_CAIXA_DEBUG_KEY);
    const list: unknown[] = raw ? JSON.parse(raw) : [];
    const next = [...(Array.isArray(list) ? list : []), entry].slice(-80);
    localStorage.setItem(POS_CAIXA_DEBUG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function readPosCaixaCache(branchId: string): CaixaSession | null {
  try {
    const raw = localStorage.getItem(`${POS_CAIXA_CACHE_PREFIX}${branchId}`);
    if (!raw) return null;
    const session = JSON.parse(raw) as CaixaSession;
    if (session.status !== 'open') return null;
    return session;
  } catch {
    return null;
  }
}

/** Find any cached open shift whose branch matches (handles id remaps after update). */
function findCachedOpenSession(branchId: string): CaixaSession | null {
  const direct = readPosCaixaCache(branchId);
  if (direct) return direct;
  try {
    const matches: CaixaSession[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(POS_CAIXA_CACHE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session = JSON.parse(raw) as CaixaSession;
      if (session?.status !== 'open') continue;
      if (branchIdsEquivalent(session.branchId, branchId) || branchIdsEquivalent(key.slice(POS_CAIXA_CACHE_PREFIX.length), branchId)) {
        matches.push(session);
      }
    }
    matches.sort(
      (a, b) => new Date(b.openedAt || b.createdAt).getTime() - new Date(a.openedAt || a.createdAt).getTime(),
    );
    return matches[0] || null;
  } catch {
    return null;
  }
}

function writePosCaixaCache(branchId: string, session: CaixaSession): void {
  if (session.status !== 'open') return;
  localStorage.setItem(`${POS_CAIXA_CACHE_PREFIX}${branchId}`, JSON.stringify(session));
  if (session.branchId && !branchIdsEquivalent(session.branchId, branchId)) {
    localStorage.setItem(`${POS_CAIXA_CACHE_PREFIX}${session.branchId}`, JSON.stringify(session));
  }
  // Mirror into durable session list so restart recovery works even if the sticky key is lost.
  try {
    const key = 'kwanzaerp_caixa_sessions';
    const raw = localStorage.getItem(key);
    const list: CaixaSession[] = raw ? JSON.parse(raw) : [];
    const next = [
      ...list.filter(
        (s) =>
          s.id !== session.id
          && !(s.status === 'open' && branchIdsEquivalent(s.branchId, session.branchId || branchId)),
      ),
      session,
    ];
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function clearPosCaixaCache(branchId: string): void {
  localStorage.removeItem(`${POS_CAIXA_CACHE_PREFIX}${branchId}`);
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(POS_CAIXA_CACHE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const session = JSON.parse(raw) as CaixaSession;
        if (branchIdsEquivalent(session.branchId, branchId) || branchIdsEquivalent(key.slice(POS_CAIXA_CACHE_PREFIX.length), branchId)) {
          toRemove.push(key);
        }
      } catch {
        /* ignore */
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  // Also seal leftover "open" rows in the durable sessions list — otherwise a second
  // Electron window can revive the shift via getOpenCaixaSessionForBranch.
  try {
    const key = 'kwanzaerp_caixa_sessions';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const list: CaixaSession[] = JSON.parse(raw);
    let changed = false;
    const next = list.map((s) => {
      if (s.status !== 'open') return s;
      if (!branchIdsEquivalent(s.branchId, branchId)) return s;
      changed = true;
      return {
        ...s,
        status: 'closed' as const,
        closedAt: s.closedAt || new Date().toISOString(),
      };
    });
    if (changed) localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export const CAIXA_CLOSED_EVENT = 'nexor:caixa-closed';
const CAIXA_CLOSED_PING_PREFIX = 'nexor:pos-caixa-closed-ping:v1:';

function broadcastCaixaClosed(branchId: string, closedAt = new Date().toISOString()): void {
  try {
    window.dispatchEvent(
      new CustomEvent(CAIXA_CLOSED_EVENT, { detail: { branchId, at: closedAt } }),
    );
  } catch {
    /* ignore */
  }
  // Cross-window signal (CustomEvent stays in one renderer; storage fires elsewhere).
  try {
    localStorage.setItem(`${CAIXA_CLOSED_PING_PREFIX}${branchId}`, closedAt);
  } catch {
    /* ignore */
  }
}

/** City confirmed no open shift — seal leftover local open rows so they cannot re-open city. */
async function sealLocalAfterCityClosed(branchId: string): Promise<void> {
  clearPosCaixaCache(branchId);
  try {
    const local = await getOpenCaixaSessionForBranch(branchId);
    if (!local || local.status !== 'open') return;
    const counted =
      Number(local.openingBalance || 0)
      + Number(local.totalIn || 0)
      - Number(local.totalOut || 0);
    await closeCaixaSession(
      local.id,
      counted,
      'system',
      'Sealed after city confirmed register closed',
    );
  } catch (err) {
    console.warn('[usePosCaixa] seal local after city closed:', err);
  }
}

function mergeSessionTotals(server: CaixaSession, cached: CaixaSession): CaixaSession {
  if (server.id !== cached.id) return server;
  return {
    ...server,
    totalIn: Math.max(server.totalIn, cached.totalIn),
    totalOut: Math.max(server.totalOut, cached.totalOut),
    salesTotal: Math.max(server.salesTotal, cached.salesTotal),
    expensesTotal: Math.max(server.expensesTotal, cached.expensesTotal),
    adjustments: Math.max(server.adjustments, cached.adjustments),
  };
}

function mapServerSession(row: Record<string, unknown>): CaixaSession {
  return {
    id: String(row.id),
    caixaId: String(row.caixaId ?? row.caixa_id ?? ''),
    branchId: String(row.branchId ?? row.branch_id ?? ''),
    date: String(row.date ?? '').slice(0, 10),
    openingBalance: Number(row.openingBalance ?? row.opening_balance) || 0,
    closingBalance:
      row.closingBalance != null || row.closing_balance != null
        ? Number(row.closingBalance ?? row.closing_balance)
        : undefined,
    totalIn: Number(row.totalIn ?? row.total_in) || 0,
    totalOut: Number(row.totalOut ?? row.total_out) || 0,
    salesTotal: Number(row.salesTotal ?? row.sales_total) || 0,
    expensesTotal: Number(row.expensesTotal ?? row.expenses_total) || 0,
    adjustments: Number(row.adjustments) || 0,
    status: (row.status as CaixaSession['status']) || 'open',
    openedBy: String(row.openedBy ?? row.opened_by ?? ''),
    openedAt: String(row.openedAt ?? row.opened_at ?? ''),
    closedBy: row.closedBy != null ? String(row.closedBy) : row.closed_by != null ? String(row.closed_by) : undefined,
    closedAt: row.closedAt != null ? String(row.closedAt) : row.closed_at != null ? String(row.closed_at) : undefined,
    notes: row.notes != null ? String(row.notes) : undefined,
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  };
}

type RemoteOpenLookup =
  | { kind: 'open'; session: CaixaSession }
  | { kind: 'none' }
  | { kind: 'error'; error: string };

async function fetchRemoteOpenSession(
  branchId: string,
  opts?: { syncExpenses?: boolean },
): Promise<RemoteOpenLookup> {
  try {
    const remote = await api.caixa.getOpenSession(branchId, {
      syncExpenses: opts?.syncExpenses,
    });
    if (remote.error) {
      return { kind: 'error', error: String(remote.error) };
    }
    if (!remote.data) return { kind: 'none' };
    const session = mapServerSession(remote.data as Record<string, unknown>);
    if (session.status !== 'open') return { kind: 'none' };
    return { kind: 'open', session };
  } catch (err) {
    console.warn('[usePosCaixa] server open session lookup:', err);
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function loadLocalOpenSession(branchId: string): Promise<CaixaSession | null> {
  try {
    const local = await getOpenCaixaSessionForBranch(branchId);
    return local?.status === 'open' ? local : null;
  } catch (err) {
    console.warn('[usePosCaixa] local open session lookup:', err);
    return null;
  }
}

/** Load register metadata without blocking the open-caixa dialog. */
async function loadBranchCaixaMeta(
  branchId: string,
  branchName: string,
  ensureIfEmpty: boolean,
): Promise<Caixa | null> {
  const list = await getCaixas(branchId, branchName, { ensureIfEmpty: false });
  if (list.length > 0) return list[0];
  if (!ensureIfEmpty) return null;
  return ensureBranchCaixa(branchId, branchName, { ensureIfEmpty: true });
}

/**
 * Cash-register (caixa) session state for the POS, scoped to the active branch.
 * Open session persists until end-of-day close — not re-prompted on POS navigation / app restart.
 */
export function usePosCaixa(branchId?: string, branchName?: string) {
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [session, setSession] = useState<CaixaSession | null>(() =>
    (branchId ? findCachedOpenSession(branchId) : null),
  );
  const [loading, setLoading] = useState(() =>
    !(branchId && findCachedOpenSession(branchId)),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const metaLoadRef = useRef(0);

  const refresh = useCallback(async (options?: { silent?: boolean; syncExpenses?: boolean }) => {
    if (!branchId) {
      // Branch not ready yet after restart — do NOT clear an in-memory open shift.
      setLoading(false);
      return;
    }

    const cached = findCachedOpenSession(branchId);
    const prior = sessionRef.current;
    const sticky = cached ?? (prior?.status === 'open' ? prior : null);

    if (sticky?.status === 'open') {
      setSession(sticky);
      // Do not rewrite cache yet — another window may have just closed; writing open
      // here raced city lookup and resurrected the shift in sibling instances.
      setLoading(false);
      // Always pull server totals (expenses/refunds), even on silent refresh — otherwise
      // a stale localStorage cache hides caixa expenses paid after the session opened.
      void fetchRemoteOpenSession(branchId, { syncExpenses: options?.syncExpenses }).then((remote) => {
        if (remote.kind === 'open') {
          if (sticky && remote.session.id !== sticky.id) {
            // After EOD + reopen, a late probe can still see the old city shift.
            // Never replace a newer local open with an older remote leftover.
            const stickyAt = new Date(sticky.openedAt || sticky.createdAt || 0).getTime();
            const remoteAt = new Date(remote.session.openedAt || remote.session.createdAt || 0).getTime();
            if (stickyAt >= remoteAt) {
              writePosCaixaCache(branchId, sticky);
              return;
            }
          }
          const merged =
            sticky && remote.session.id === sticky.id
              ? mergeSessionTotals(remote.session, sticky)
              : remote.session;
          setSession(merged);
          writePosCaixaCache(branchId, merged);
          return;
        }
        if (remote.kind === 'none') {
          // City authoritatively has no open shift (EOD closed from this or another
          // window). Drop sticky — keeping it rewrote the cache and brought invoices back.
          logCaixaDebug('refresh:city-none-drop-sticky', {
            stickyId: sticky.id,
            branchId,
          });
          void sealLocalAfterCityClosed(branchId);
          if (sticky.branchId && !branchIdsEquivalent(sticky.branchId, branchId)) {
            void sealLocalAfterCityClosed(sticky.branchId);
          }
          setSession(null);
          return;
        }
        // On error: keep sticky — restart/update must not drop an open day.
        writePosCaixaCache(branchId, sticky);
      });
      const metaToken = ++metaLoadRef.current;
      void loadBranchCaixaMeta(branchId, branchName || branchId, false)
        .then((cx) => {
          if (metaToken === metaLoadRef.current && cx) setCaixa(cx);
        })
        .catch(() => {});
      return;
    }

    if (!options?.silent) setLoading(true);

    try {
      const remote = await withTimeout(
        fetchRemoteOpenSession(branchId, { syncExpenses: options?.syncExpenses }),
        options?.silent ? 8000 : 4000,
        { kind: 'error', error: 'timeout' } as RemoteOpenLookup,
      );
      if (remote.kind === 'open') {
        setSession(remote.session);
        writePosCaixaCache(branchId, remote.session);
        setLoading(false);
        const metaToken = ++metaLoadRef.current;
        void loadBranchCaixaMeta(branchId, branchName || branchId, false)
          .then((cx) => {
            if (metaToken === metaLoadRef.current && cx) setCaixa(cx);
          })
          .catch(() => {});
        return;
      }

      if (remote.kind === 'error') {
        // Network / auth glitch — keep local evidence; do not force a false "open register".
        console.warn('[usePosCaixa] open-session lookup failed; not clearing local shift:', remote.error);
        const local = await loadLocalOpenSession(branchId);
        const anyCached = local || findCachedOpenSession(branchId) || (() => {
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (!key?.startsWith(POS_CAIXA_CACHE_PREFIX)) continue;
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const sess = JSON.parse(raw) as CaixaSession;
              if (sess?.status === 'open') return sess;
            }
          } catch {
            /* ignore */
          }
          return null;
        })();
        if (anyCached) {
          setSession(anyCached);
          writePosCaixaCache(branchId, { ...anyCached, branchId });
        }
        setLoading(false);
        const metaToken = ++metaLoadRef.current;
        void loadBranchCaixaMeta(branchId, branchName || branchId, true)
          .then((cx) => {
            if (metaToken === metaLoadRef.current && cx) setCaixa(cx);
          })
          .catch(() => {});
        return;
      }

      // City says none — authoritative. Never resurrect a leftover local open row
      // (that re-opened city and brought shift invoices back in a second instance).
      logCaixaDebug('refresh:city-none-clear-local', { branchId });
      await sealLocalAfterCityClosed(branchId);
      setSession(null);
      setLoading(false);

      const metaToken = ++metaLoadRef.current;
      void loadBranchCaixaMeta(branchId, branchName || branchId, true)
        .then((cx) => {
          if (metaToken === metaLoadRef.current && cx) setCaixa(cx);
        })
        .catch((err) => {
          console.warn('[usePosCaixa] register metadata load:', err);
        });
    } catch (err) {
      console.error('[usePosCaixa] load failed:', err);
      if (sticky) {
        setSession(sticky);
      }
      setLoading(false);
    }
  }, [branchId, branchName]);

  useEffect(() => {
    const cached = branchId ? findCachedOpenSession(branchId) : null;
    if (cached) {
      setSession(cached);
      setLoading(false);
    }
    void refresh({ silent: !!cached });
  }, [refresh, branchId]);

  useTableRefreshListener('caixa_sessions', () => {
    void refresh({ silent: true });
  });

  // Another window closed the register — drop our sticky open shift.
  useEffect(() => {
    if (!branchId) return;
    const dropLocal = () => {
      clearPosCaixaCache(branchId);
      setSession(null);
      void refresh({ silent: true });
    };
    const onClosed = (event: Event) => {
      const detail = (event as CustomEvent<{ branchId?: string }>).detail;
      if (detail?.branchId && !branchIdsEquivalent(detail.branchId, branchId)) return;
      dropLocal();
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key.startsWith(CAIXA_CLOSED_PING_PREFIX)) {
        const keyBranch = event.key.slice(CAIXA_CLOSED_PING_PREFIX.length);
        if (branchIdsEquivalent(keyBranch, branchId)) dropLocal();
        return;
      }
      if (event.key.startsWith(POS_CAIXA_CACHE_PREFIX) && event.newValue == null) {
        const keyBranch = event.key.slice(POS_CAIXA_CACHE_PREFIX.length);
        if (branchIdsEquivalent(keyBranch, branchId)) dropLocal();
      }
    };
    window.addEventListener(CAIXA_CLOSED_EVENT, onClosed);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CAIXA_CLOSED_EVENT, onClosed);
      window.removeEventListener('storage', onStorage);
    };
  }, [branchId, refresh]);

  const openSession = useCallback(
    async (openingCash: number, openedBy: string) => {
      if (!branchId) return null;

      // Dialog open is always intentional — never reclaim a leftover local/remote
      // "open" shift (that ignored the new drawer count and brought old cash back).
      // Crash recovery lives in refresh()/cache on POS mount, not here.

      // Local-first register metadata (avoid Tailscale round-trips before POS unlocks).
      const cx =
        caixa
        ?? (await ensureBranchCaixa(branchId, branchName || branchId, {
          ensureIfEmpty: true,
          localOnly: true,
        }));
      setCaixa(cx);

      const sess = await openCaixaSession(cx.id, branchId, openingCash, openedBy);
      setSession(sess);
      writePosCaixaCache(branchId, sess);

      // Await city open with forceNew so leftovers are closed before any refresh
      // can resurrect yesterday's totals into this shift.
      try {
        const openRes = await api.caixa.openSession({
          id: sess.id,
          caixaId: sess.caixaId,
          branchId: sess.branchId,
          branchName: branchName || branchId,
          openingBalance: sess.openingBalance,
          openedBy: sess.openedBy,
          date: sess.date || todayLocalDate(),
          openedAt: sess.openedAt,
          forceNew: true,
        });
        if (openRes.error) {
          console.warn('[usePosCaixa] server open sync:', openRes.error);
        } else {
          const remote = openRes.data ? mapServerSession(openRes.data as Record<string, unknown>) : null;
          if (remote?.id && remote.status === 'open') {
            // Prefer server row when forceNew created/returned it; keep our opening cash
            // if the server somehow omitted it.
            const adopted = {
              ...remote,
              openingBalance: Number(remote.openingBalance) || sess.openingBalance,
            };
            setSession(adopted);
            writePosCaixaCache(branchId, adopted);
            return adopted;
          }
        }
      } catch (err) {
        console.warn('[usePosCaixa] server open sync:', err);
      }

      return sess;
    },
    [branchId, branchName, caixa],
  );

  const closeSession = useCallback(
    async (countedCash: number, closedBy: string, notes?: string) => {
      if (!session) return;
      const snapshot = { ...session };
      const caixaSnap = caixa;

      logCaixaDebug('close:start', {
        sessionId: snapshot.id,
        branchId: snapshot.branchId,
        countedCash,
        openingBalance: snapshot.openingBalance,
        totalIn: snapshot.totalIn,
        totalOut: snapshot.totalOut,
        salesTotal: snapshot.salesTotal,
      });

      // Prefer the city open-session id when local id is stale (session_* / never synced).
      let closeId = snapshot.id;
      try {
        const remoteOpen = await api.caixa.getOpenSession(snapshot.branchId || branchId || '', {
          syncExpenses: false,
        });
        const remote = remoteOpen.data as CaixaSession | null | undefined;
        if (!remoteOpen.error && remote?.id && remote.status === 'open') {
          if (remote.id !== snapshot.id) {
            logCaixaDebug('close:id-mismatch', { localId: snapshot.id, cityId: remote.id });
          }
          closeId = remote.id;
        }
      } catch (err) {
        logCaixaDebug('close:lookup-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // City close first — only then clear local. Otherwise a failed close unlocks
      // the open-register dialog while the city shift (and old cash) is still open.
      try {
        const closeRes = await api.caixa.closeSession(closeId, {
          caixaId: snapshot.caixaId,
          branchId: snapshot.branchId,
          date: snapshot.date,
          openingBalance: snapshot.openingBalance,
          closingBalance: countedCash,
          totalIn: snapshot.totalIn,
          totalOut: snapshot.totalOut,
          salesTotal: snapshot.salesTotal,
          expensesTotal: snapshot.expensesTotal,
          adjustments: snapshot.adjustments,
          openedBy: snapshot.openedBy,
          closedBy,
          openedAt: snapshot.openedAt,
          notes,
          caixa: caixaSnap
            ? {
                id: caixaSnap.id,
                branchId: caixaSnap.branchId,
                branchName: caixaSnap.branchName,
                name: caixaSnap.name,
                openingBalance: caixaSnap.openingBalance,
                currentBalance: countedCash,
                closingBalance: countedCash,
                status: 'closed',
              }
            : undefined,
        });
        if (closeRes.error) {
          logCaixaDebug('close:server-error', { error: closeRes.error, status: closeRes.status });
          throw new Error(closeRes.error);
        }
        logCaixaDebug('close:server-ok', {
          sealedExtra: (closeRes.data as { sealedExtra?: number } | undefined)?.sealedExtra,
        });

        // Verify city has no open shift left for this branch (id-mismatch / race).
        const still = await api.caixa.getOpenSession(snapshot.branchId || branchId || '');
        if (!still.error && still.data && (still.data as CaixaSession).status === 'open') {
          const leftover = still.data as CaixaSession;
          logCaixaDebug('close:still-open', {
            leftoverId: leftover.id,
            openingBalance: leftover.openingBalance,
            totalIn: leftover.totalIn,
          });
          // One more seal attempt via forceNew-style close of the leftover id.
          const seal = await api.caixa.closeSession(leftover.id, {
            caixaId: leftover.caixaId,
            branchId: leftover.branchId || snapshot.branchId,
            date: leftover.date,
            openingBalance: leftover.openingBalance,
            closingBalance: countedCash,
            totalIn: leftover.totalIn,
            totalOut: leftover.totalOut,
            salesTotal: leftover.salesTotal,
            expensesTotal: leftover.expensesTotal,
            adjustments: leftover.adjustments,
            openedBy: leftover.openedBy,
            closedBy,
            openedAt: leftover.openedAt,
            notes: notes || 'Second-pass seal after EOD verify',
          });
          if (seal.error) {
            logCaixaDebug('close:seal-failed', { error: seal.error });
            throw new Error(seal.error);
          }
        }
      } catch (err) {
        logCaixaDebug('close:failed', { error: err instanceof Error ? err.message : String(err) });
        console.warn('[usePosCaixa] server close sync:', err);
        throw err instanceof Error ? err : new Error(String(err));
      }

      try {
        await closeCaixaSession(snapshot.id, countedCash, closedBy, notes);
      } catch (err) {
        console.warn('[usePosCaixa] local close failed:', err);
      }
      if (branchId) clearPosCaixaCache(branchId);
      if (snapshot.branchId && !branchIdsEquivalent(snapshot.branchId, branchId || '')) {
        clearPosCaixaCache(snapshot.branchId);
      }
      setSession(null);
      const closedAt = new Date().toISOString();
      if (snapshot.branchId) markPosCaixaClosed(snapshot.branchId, closedAt);
      if (branchId && branchId !== snapshot.branchId) markPosCaixaClosed(branchId, closedAt);
      if (snapshot.branchId) broadcastCaixaClosed(snapshot.branchId, closedAt);
      else if (branchId) broadcastCaixaClosed(branchId, closedAt);
      logCaixaDebug('close:local-cleared', { sessionId: snapshot.id, closedAt });
    },
    [session, caixa, branchId],
  );

  const recordCashSale = useCallback(
    (amount: number) => {
      setSession((prev) => {
        if (!prev || !branchId) return prev;
        const next = {
          ...prev,
          totalIn: prev.totalIn + amount,
          salesTotal: prev.salesTotal + amount,
        };
        writePosCaixaCache(branchId, next);
        return next;
      });
    },
    [branchId],
  );

  const recordCashRefund = useCallback(
    (amount: number) => {
      setSession((prev) => {
        if (!prev || !branchId) return prev;
        const next = {
          ...prev,
          totalOut: prev.totalOut + amount,
        };
        writePosCaixaCache(branchId, next);
        return next;
      });
    },
    [branchId],
  );

  const recordCashExpense = useCallback(
    (amount: number) => {
      setSession((prev) => {
        if (!prev || !branchId) return prev;
        const next = {
          ...prev,
          totalOut: prev.totalOut + amount,
          expensesTotal: prev.expensesTotal + amount,
        };
        writePosCaixaCache(branchId, next);
        return next;
      });
    },
    [branchId],
  );

  const adoptOpenedAt = useCallback(
    (openedAt: string) => {
      if (!branchId || !openedAt) return;
      setSession((prev) => {
        if (!prev || prev.status !== 'open') return prev;
        const prevMs = new Date(prev.openedAt).getTime();
        const nextMs = new Date(openedAt).getTime();
        if (!Number.isFinite(nextMs) || nextMs >= prevMs) return prev;
        // Do not backdate across a successful EOD close watermark.
        const lastClosed = getPosCaixaLastClosedAt(prev.branchId || branchId);
        const lastClosedMs = lastClosed ? new Date(lastClosed).getTime() : NaN;
        if (Number.isFinite(lastClosedMs) && nextMs < lastClosedMs) return prev;
        const next = { ...prev, openedAt };
        writePosCaixaCache(branchId, next);
        return next;
      });
    },
    [branchId],
  );

  return {
    caixa,
    session,
    loading,
    refresh,
    openSession,
    closeSession,
    recordCashSale,
    recordCashRefund,
    recordCashExpense,
    adoptOpenedAt,
  };
}
