import { useSales } from '@/hooks/useERP';
import { REPORT_SALES_LIMIT, useReportsPeriodOptional } from '@/contexts/ReportsPeriodContext';

/** Period-scoped sales for report screens. Falls back to this month if used outside Reports. */
export function useReportSales() {
  const period = useReportsPeriodOptional();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
  const dateFrom = period?.dateFrom || `${y}-${m}-01`;
  const dateTo = period?.dateTo || `${y}-${m}-${lastDay}`;
  const branchId = period?.apiBranchId;
  const { sales, refreshSales } = useSales(branchId, {
    light: false,
    dateFrom,
    dateTo,
    limit: REPORT_SALES_LIMIT,
  });
  return {
    sales,
    refreshSales,
    truncated: sales.length >= REPORT_SALES_LIMIT,
    dateFrom,
    dateTo,
    branchId,
    limit: REPORT_SALES_LIMIT,
  };
}
