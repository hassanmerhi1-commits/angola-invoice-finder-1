import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { CreditNote } from '@/types/erp';

/**
 * Credit notes for report netting — scoped by optional branch and date range.
 */
export function useReportCreditNotes(
  branchId?: string,
  opts?: { dateFrom?: string; dateTo?: string },
) {
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateFrom = opts?.dateFrom;
  const dateTo = opts?.dateTo;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fiscalDocuments.listCreditNotes(branchId || undefined, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      if (res.error) throw new Error(res.error);
      setCreditNotes((res.data || []) as CreditNote[]);
    } catch (e) {
      console.warn('[useReportCreditNotes] list failed:', e);
      setCreditNotes([]);
      setError(e instanceof Error ? e.message : 'Failed to load credit notes');
    } finally {
      setLoading(false);
    }
  }, [branchId, dateFrom, dateTo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { creditNotes, loading, error, refresh };
}
