import { useCallback, useEffect, useState } from 'react';
import {
  ensureBranchCaixa,
  getOpenCaixaSession,
  openCaixaSession,
  closeCaixaSession,
} from '@/lib/accountingStorage';
import type { Caixa, CaixaSession } from '@/types/accounting';

/**
 * Cash-register (caixa) session state for the POS, scoped to the active branch.
 *
 * The shift must be opened with an opening-cash count before any sale, and closed
 * with a counted-cash amount at end of day so the system can reconcile expected vs.
 * counted (over/short). The branch's single "Caixa Principal" is reused; one open
 * session per branch at a time (matches the Caixa management model).
 */
export function usePosCaixa(branchId?: string, branchName?: string) {
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [session, setSession] = useState<CaixaSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!branchId) {
      setCaixa(null);
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const cx = await ensureBranchCaixa(branchId, branchName || branchId);
      setCaixa(cx);
      const sess = await getOpenCaixaSession(cx.id);
      setSession(sess ?? null);
    } catch (err) {
      console.error('[usePosCaixa] load failed:', err);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, branchName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSession = useCallback(
    async (openingCash: number, openedBy: string) => {
      if (!branchId) return null;
      const cx = caixa ?? (await ensureBranchCaixa(branchId, branchName || branchId));
      setCaixa(cx);
      const existing = await getOpenCaixaSession(cx.id);
      if (existing) {
        setSession(existing);
        return existing;
      }
      const sess = await openCaixaSession(cx.id, branchId, openingCash, openedBy);
      setSession(sess);
      return sess;
    },
    [branchId, branchName, caixa],
  );

  const closeSession = useCallback(
    async (countedCash: number, closedBy: string, notes?: string) => {
      if (!session) return;
      await closeCaixaSession(session.id, countedCash, closedBy, notes);
      setSession(null);
    },
    [session],
  );

  /**
   * Record a cash sale against the open shift. Kept in component state so the gate
   * stays closed and end-of-day totals stay correct even when the accounting store
   * isn't persisted in this run mode (SQLite desktop reserves the DB for Express).
   */
  const recordCashSale = useCallback((amount: number) => {
    setSession((prev) =>
      prev
        ? { ...prev, totalIn: prev.totalIn + amount, salesTotal: prev.salesTotal + amount }
        : prev,
    );
  }, []);

  return { caixa, session, loading, refresh, openSession, closeSession, recordCashSale };
}
