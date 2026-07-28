import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureBranchCaixa,
  getCaixas,
  getOpenCaixaSessionForBranch,
  openCaixaSession,
  closeCaixaSession,
} from '@/lib/accountingStorage';
import { api } from '@/lib/api/client';
import { todayLocalDate } from '@/lib/posShiftSales';
import { branchIdsEquivalent } from '@/lib/branchAccess';
import { useTableRefreshListener } from '@/hooks/useRealtimeSyncBridge';
import type { Caixa, CaixaSession } from '@/types/accounting';

const POS_CAIXA_CACHE_PREFIX = 'nexor:pos-caixa-open:v1:';

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

async function resyncOpenSessionToServer(
  sess: CaixaSession,
  branchName: string,
): Promise<void> {
  try {
    await api.caixa.openSession({
      id: sess.id,
      caixaId: sess.caixaId,
      branchId: sess.branchId,
      branchName: branchName || sess.branchId,
      openingBalance: sess.openingBalance,
      openedBy: sess.openedBy,
      date: sess.date || todayLocalDate(),
      openedAt: sess.openedAt,
    });
  } catch (err) {
    console.warn('[usePosCaixa] re-sync open session:', err);
  }
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
      writePosCaixaCache(branchId, sticky);
      setLoading(false);
      // Always pull server totals (expenses/refunds), even on silent refresh — otherwise
      // a stale localStorage cache hides caixa expenses paid after the session opened.
      void fetchRemoteOpenSession(branchId, { syncExpenses: options?.syncExpenses }).then((remote) => {
        if (remote.kind === 'open') {
          const merged =
            sticky && remote.session.id === sticky.id
              ? mergeSessionTotals(remote.session, sticky)
              : remote.session;
          setSession(merged);
          writePosCaixaCache(branchId, merged);
        }
        // On error or none: keep sticky — restart/update must not drop an open day.
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

      const local = await loadLocalOpenSession(branchId);
      if (local) {
        setSession(local);
        writePosCaixaCache(branchId, local);
        setLoading(false);
        void resyncOpenSessionToServer(local, branchName || branchId);
        const metaToken = ++metaLoadRef.current;
        void loadBranchCaixaMeta(branchId, branchName || branchId, false)
          .then((cx) => {
            if (metaToken === metaLoadRef.current && cx) setCaixa(cx);
          })
          .catch(() => {});
        return;
      }

      if (remote.kind === 'error') {
        // Network / auth glitch after update — keep UI from forcing a false "open caixa".
        console.warn('[usePosCaixa] open-session lookup failed; not clearing local shift:', remote.error);
        const anyCached = findCachedOpenSession(branchId) || (() => {
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

      // Server says none — do NOT clear local sticky cache. Thin clients often open
      // local-first and city sync fails; wiping cache forces a second "open register".
      // Only show the open dialog when we truly have no local evidence.
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

  const openSession = useCallback(
    async (openingCash: number, openedBy: string) => {
      if (!branchId) return null;

      // Fast reclaim — no network.
      const cached = findCachedOpenSession(branchId);
      if (cached?.status === 'open') {
        setSession(cached);
        writePosCaixaCache(branchId, cached);
        void resyncOpenSessionToServer(cached, branchName || branchId);
        return cached;
      }
      const localExisting = await loadLocalOpenSession(branchId);
      if (localExisting) {
        setSession(localExisting);
        writePosCaixaCache(branchId, localExisting);
        void resyncOpenSessionToServer(localExisting, branchName || branchId);
        return localExisting;
      }

      // Local-first register metadata (avoid Tailscale round-trips before POS unlocks).
      const cx =
        caixa
        ?? (await ensureBranchCaixa(branchId, branchName || branchId, {
          ensureIfEmpty: true,
          localOnly: true,
        }));
      setCaixa(cx);

      // Brief remote probe — if server already has an open shift, reuse it.
      const remote = await withTimeout(
        fetchRemoteOpenSession(branchId),
        2500,
        { kind: 'error', error: 'timeout' } as RemoteOpenLookup,
      );
      if (remote.kind === 'open') {
        setSession(remote.session);
        writePosCaixaCache(branchId, remote.session);
        return remote.session;
      }

      // Unlock POS immediately with a local session; sync city in the background.
      const sess = await openCaixaSession(cx.id, branchId, openingCash, openedBy);
      setSession(sess);
      writePosCaixaCache(branchId, sess);

      void (async () => {
        try {
          // If a slow remote reply arrives with an existing open session, prefer it.
          const late = await withTimeout(
            fetchRemoteOpenSession(branchId),
            5000,
            { kind: 'none' } as RemoteOpenLookup,
          );
          if (late.kind === 'open' && late.session.id !== sess.id) {
            setSession(late.session);
            writePosCaixaCache(branchId, late.session);
            return;
          }
          await api.caixa.openSession({
            id: sess.id,
            caixaId: sess.caixaId,
            branchId: sess.branchId,
            branchName: branchName || branchId,
            openingBalance: sess.openingBalance,
            openedBy: sess.openedBy,
            date: sess.date || todayLocalDate(),
            openedAt: sess.openedAt,
          });
        } catch (err) {
          console.warn('[usePosCaixa] server open sync:', err);
        }
      })();

      return sess;
    },
    [branchId, branchName, caixa],
  );

  const closeSession = useCallback(
    async (countedCash: number, closedBy: string, notes?: string) => {
      if (!session) return;
      const snapshot = { ...session };
      const caixaSnap = caixa;

      // Clear UI immediately so the cashier is not stuck on a slow Tailscale close.
      if (branchId) clearPosCaixaCache(branchId);
      setSession(null);

      try {
        await closeCaixaSession(snapshot.id, countedCash, closedBy, notes);
      } catch (err) {
        console.warn('[usePosCaixa] local close failed:', err);
      }

      void (async () => {
        try {
          await api.caixa.closeSession(snapshot.id, {
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
        } catch (err) {
          console.warn('[usePosCaixa] server close sync:', err);
        }
      })();
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
