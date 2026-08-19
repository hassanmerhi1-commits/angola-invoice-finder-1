import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { endOfMonth, format, startOfMonth, startOfYear, subMonths } from 'date-fns';
import { useSyncedBranchFilter } from '@/hooks/useSyncedBranchFilter';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { useTranslation } from '@/i18n';

export const REPORT_SALES_LIMIT = 10000;

export type ReportsPeriodPreset = 'today' | 'thisMonth' | 'lastMonth' | 'thisYear';

type BranchFilter = ReturnType<typeof useSyncedBranchFilter>;

export type ReportsPeriodValue = {
  dateFrom: string;
  dateTo: string;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  applyPreset: (preset: ReportsPeriodPreset) => void;
  comparePrevious: boolean;
  setComparePrevious: (value: boolean) => void;
  branchFilter: BranchFilter;
  apiBranchId: string | undefined;
  branchLabel: string;
  periodLabel: string;
  previousPeriod: { dateFrom: string; dateTo: string } | null;
  yearAgoPeriod: { dateFrom: string; dateTo: string } | null;
  salesQuery: {
    light: false;
    dateFrom: string;
    dateTo: string;
    limit: number;
  };
};

const ReportsPeriodContext = createContext<ReportsPeriodValue | null>(null);

function iso(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

function presetRange(preset: ReportsPeriodPreset): { from: string; to: string } {
  const now = new Date();
  if (preset === 'today') {
    const t = iso(now);
    return { from: t, to: t };
  }
  if (preset === 'lastMonth') {
    const last = subMonths(now, 1);
    return { from: iso(startOfMonth(last)), to: iso(endOfMonth(last)) };
  }
  if (preset === 'thisYear') {
    return { from: iso(startOfYear(now)), to: iso(now) };
  }
  return { from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) };
}

export function ReportsPeriodProvider({ children }: { children: ReactNode }) {
  const initial = presetRange('thisMonth');
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [comparePrevious, setComparePrevious] = useState(false);
  const branchFilter = useSyncedBranchFilter({ defaultWhenPicker: 'current' });

  const applyPreset = useCallback((preset: ReportsPeriodPreset) => {
    const next = presetRange(preset);
    setDateFrom(next.from);
    setDateTo(next.to);
  }, []);

  const previousPeriod = useMemo(() => {
    try {
      const from = new Date(`${dateFrom}T12:00:00`);
      const to = new Date(`${dateTo}T12:00:00`);
      const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
      const prevTo = new Date(from);
      prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setDate(prevFrom.getDate() - (days - 1));
      return { dateFrom: iso(prevFrom), dateTo: iso(prevTo) };
    } catch {
      return null;
    }
  }, [dateFrom, dateTo]);

  const { t } = useTranslation();

  const yearAgoPeriod = useMemo(() => {
    try {
      const from = new Date(`${dateFrom}T12:00:00`);
      const to = new Date(`${dateTo}T12:00:00`);
      from.setFullYear(from.getFullYear() - 1);
      to.setFullYear(to.getFullYear() - 1);
      return { dateFrom: iso(from), dateTo: iso(to) };
    } catch {
      return null;
    }
  }, [dateFrom, dateTo]);

  const branchLabel = useMemo(() => {
    if (branchFilter.isAllBranches) return t.salesAnalysisUi.allBranches;
    const row = branchFilter.branches.find((b) => b.id === branchFilter.selectedBranch)
      || branchFilter.currentBranch;
    return row ? formatBranchDisplayName(row) : '';
  }, [branchFilter, t.salesAnalysisUi.allBranches]);

  const value = useMemo<ReportsPeriodValue>(() => ({
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
    applyPreset,
    comparePrevious,
    setComparePrevious,
    branchFilter,
    apiBranchId: branchFilter.apiBranchId,
    branchLabel,
    periodLabel: `${dateFrom} — ${dateTo}`,
    previousPeriod,
    yearAgoPeriod,
    salesQuery: {
      light: false,
      dateFrom,
      dateTo,
      limit: REPORT_SALES_LIMIT,
    },
  }), [
    dateFrom,
    dateTo,
    applyPreset,
    comparePrevious,
    branchFilter,
    branchLabel,
    previousPeriod,
    yearAgoPeriod,
  ]);

  return (
    <ReportsPeriodContext.Provider value={value}>
      {children}
    </ReportsPeriodContext.Provider>
  );
}

export function useReportsPeriodOptional() {
  return useContext(ReportsPeriodContext);
}

export function useReportsPeriod(): ReportsPeriodValue {
  const ctx = useContext(ReportsPeriodContext);
  if (!ctx) {
    throw new Error('useReportsPeriod must be used inside ReportsPeriodProvider');
  }
  return ctx;
}

/** Dates / branch / compare from the shared reports bar, or local state when used outside Reports. */
export function useSharedReportFilters(defaults?: { dateFrom?: string; dateTo?: string }) {
  const period = useReportsPeriodOptional();
  const localBranch = useSyncedBranchFilter();
  const fallback = defaults ?? presetRange('thisMonth');
  const [localFrom, setLocalFrom] = useState(fallback.from);
  const [localTo, setLocalTo] = useState(fallback.to);
  const [localCompare, setLocalCompare] = useState(false);

  if (period) {
    return {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      setDateFrom: period.setDateFrom,
      setDateTo: period.setDateTo,
      comparePrevious: period.comparePrevious,
      setComparePrevious: period.setComparePrevious,
      branchFilter: period.branchFilter,
      apiBranchId: period.apiBranchId,
      previousPeriod: period.previousPeriod,
      yearAgoPeriod: period.yearAgoPeriod,
      periodLabel: period.periodLabel,
      branchLabel: period.branchLabel,
      shared: true as const,
    };
  }

  return {
    dateFrom: localFrom,
    dateTo: localTo,
    setDateFrom: setLocalFrom,
    setDateTo: setLocalTo,
    comparePrevious: localCompare,
    setComparePrevious: setLocalCompare,
    branchFilter: localBranch,
    apiBranchId: localBranch.apiBranchId,
    previousPeriod: null,
    yearAgoPeriod: null,
    periodLabel: `${localFrom} — ${localTo}`,
    branchLabel: localBranch.isAllBranches
      ? ''
      : formatBranchDisplayName(
          localBranch.branches.find((b) => b.id === localBranch.selectedBranch)
            || localBranch.currentBranch,
        ),
    shared: false as const,
  };
}
