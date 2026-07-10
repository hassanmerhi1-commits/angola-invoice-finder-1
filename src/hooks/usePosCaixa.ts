import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureBranchCaixa,
  getCaixas,
  openCaixaSession,
  closeCaixaSession,
} from '@/lib/accountingStorage';
import { api } from '@/lib/api/client';
import { todayLocalDate } from '@/lib/posShiftSales';
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

function writePosCaixaCache(branchId: string, session: CaixaSession): void {
  if (session.status !== 'open') return;
  localStorage.setItem(`${POS_CAIXA_CACHE_PREFIX}${branchId}`, JSON.stringify(session));
}

function clearPosCaixaCache(branchId: string): void {
  localStorage.removeItem(`${POS_CAIXA_CACHE_PREFIX}${branchId}`);
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

async function fetchRemoteOpenSession(branchId: string): Promise<CaixaSession | null> {
  try {
    const remote = await api.caixa.getOpenSession(branchId);
    if (!remote.data) return null;
    return mapServerSession(remote.data as Record<string, unknown>);
  } catch (err) {
    console.warn('[usePosCaixa] server open session lookup:', err);
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
 * Open session persists until end-of-day close — not re-prompted on POS navigation.
 */
export function usePosCaixa(branchId?: string, branchName?: string) {
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [session, setSession] = useState<CaixaSession | null>(() =>
    (branchId ? readPosCaixaCache(branchId) : null),
  );
  const [loading, setLoading] = useState(() =>
    !(branchId && readPosCaixaCache(branchId)),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const metaLoadRef = useRef(0);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!branchId) {
      setCaixa(null);
      setSession(null);
      setLoading(false);
      return;
    }

    const cached = readPosCaixaCache(branchId);
    const prior = sessionRef.current;
    const sticky = cached ?? (prior?.status === 'open' ? prior : null);

    if (sticky?.status === 'open') {
      setSession(sticky);
      setLoading(false);
      if (!options?.silent) {
        void fetchRemoteOpenSession(branchId).then((remote) => {
          if (remote?.status === 'open') {
            const merged =
              cached && remote.id === cached.id ? mergeSessionTotals(remote, cached) : remote;
            setSession(merged);
            writePosCaixaCache(branchId, merged);
          }
        });
      }
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
      const remoteSess = await fetchRemoteOpenSession(branchId);
      if (remoteSess?.status === 'open') {
        setSession(remoteSess);
        writePosCaixaCache(branchId, remoteSess);
        setLoading(false);
        const metaToken = ++metaLoadRef.current;
        void loadBranchCaixaMeta(branchId, branchName || branchId, false)
          .then((cx) => {
            if (metaToken === metaLoadRef.current && cx) setCaixa(cx);
          })
          .catch(() => {});
        return;
      }

      // No open session on server — unblock UI immediately so the open-caixa dialog shows.
      setSession(null);
      clearPosCaixaCache(branchId);
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
    const cached = branchId ? readPosCaixaCache(branchId) : null;
    void refresh({ silent: !!cached });
  }, [refresh, branchId]);

  useTableRefreshListener('caixa_sessions', () => {
    void refresh({ silent: true });
  });

  const openSession = useCallback(
    async (openingCash: number, openedBy: string) => {
      if (!branchId) return null;
      const cx = caixa ?? (await ensureBranchCaixa(branchId, branchName || branchId, { ensureIfEmpty: true }));
      setCaixa(cx);

      const remoteExisting = await fetchRemoteOpenSession(branchId);
      if (remoteExisting?.status === 'open') {
        setSession(remoteExisting);
        writePosCaixaCache(branchId, remoteExisting);
        return remoteExisting;
      }

      const cached = readPosCaixaCache(branchId);
      if (cached) {
        setSession(cached);
        return cached;
      }

      const sess = await openCaixaSession(cx.id, branchId, openingCash, openedBy);
      setSession(sess);
      writePosCaixaCache(branchId, sess);

      try {
        await api.caixa.openSession({
          id: sess.id,
          caixaId: sess.caixaId,
          branchId: sess.branchId,
          branchName: branchName || branchId,
          openingBalance: sess.openingBalance,
          openedBy: sess.openedBy,
          date: sess.date || todayLocalDate(),
        });
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
      await closeCaixaSession(session.id, countedCash, closedBy, notes);
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
          caixa: caixa
            ? {
                id: caixa.id,
                branchId: caixa.branchId,
                branchName: caixa.branchName,
                name: caixa.name,
                openingBalance: caixa.openingBalance,
                currentBalance: countedCash,
                closingBalance: countedCash,
                status: 'closed',
              }
            : undefined,
        });
      } catch (err) {
        console.warn('[usePosCaixa] server close sync:', err);
      }
      if (branchId) clearPosCaixaCache(branchId);
      setSession(null);
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

  return { caixa, session, loading, refresh, openSession, closeSession, recordCashSale, recordCashRefund, recordCashExpense };
}
