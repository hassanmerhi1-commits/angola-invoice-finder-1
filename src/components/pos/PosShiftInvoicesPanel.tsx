import { useMemo, useState } from 'react';
import { Sale, Branch, User } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, RefreshCw, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { filterShiftSalesForCashier, withRecoveredShiftStart } from '@/lib/posShiftSales';
import {
  listCheckoutFailures,
  readShiftIssues,
  resolveShiftSaleStatus,
  type PosShiftSaleStatus,
} from '@/lib/posShiftSaleIssues';

interface Props {
  sales: Sale[];
  session: CaixaSession | null;
  cashier: User | null;
  branch: Branch | null;
  issuesVersion: number;
  onRefresh?: () => void;
  onViewSale: (sale: Sale) => void;
}

function statusBadgeClass(status: PosShiftSaleStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300';
    case 'voided':
      return 'bg-muted text-muted-foreground';
    case 'pending':
      return 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200';
    case 'print_error':
    case 'caixa_error':
    case 'agt_error':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300';
    default:
      return '';
  }
}

export function PosShiftInvoicesPanel({
  sales,
  session,
  cashier,
  branch,
  issuesVersion,
  onRefresh,
  onViewSale,
}: Props) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [refreshing, setRefreshing] = useState(false);

  const shiftSales = useMemo(
    () => filterShiftSalesForCashier(sales, cashier, session),
    [sales, cashier, session],
  );

  const issues = useMemo(
    () => readShiftIssues(branch?.id, session?.id),
    [branch?.id, session?.id, issuesVersion],
  );

  const checkoutFailures = useMemo(
    () => listCheckoutFailures(branch?.id, session?.id),
    [branch?.id, session?.id, issuesVersion],
  );

  const statusLabel = (status: PosShiftSaleStatus) => {
    const map = t.posUi.shiftInvoices.status as Record<string, string>;
    return map[status] || status;
  };

  const paymentLabel = (method: string) => {
    const map: Record<string, string> = {
      cash: t.chartsUi.methodCash,
      card: t.chartsUi.methodCard,
      transfer: t.chartsUi.methodTransfer,
      mixed: t.chartsUi.methodMixed,
      credit: t.posUi.creditPayment,
    };
    return map[method] || method;
  };

  const shiftOpenedLabel = useMemo(() => {
    const effective = session
      ? withRecoveredShiftStart(session, sales, cashier)
      : null;
    const openedAt = effective?.openedAt || session?.openedAt;
    if (!openedAt) return null;
    const opened = new Date(openedAt);
    if (!Number.isFinite(opened.getTime())) return null;
    return t.posUi.endOfDayShiftSince.replace(
      '{time}',
      opened.toLocaleString(locale, { hour: '2-digit', minute: '2-digit' }),
    );
  }, [session, sales, cashier, locale, t.posUi.endOfDayShiftSince]);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
        <p className="text-sm text-muted-foreground">{t.posUi.shiftInvoices.noShift}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-1 pb-2 shrink-0">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {shiftOpenedLabel}
            {' · '}
            {t.posUi.shiftInvoices.count.replace('{count}', String(shiftSales.length))}
          </p>
        </div>
        {onRefresh && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs shrink-0"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1', refreshing && 'animate-spin')} />
            {t.common.refresh}
          </Button>
        )}
      </div>

      {checkoutFailures.length > 0 && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-destructive mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t.posUi.shiftInvoices.failedAttempts.replace('{count}', String(checkoutFailures.length))}
          </div>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {checkoutFailures.slice(0, 5).map((row) => (
              <li key={row.id} className="truncate" title={row.message}>
                {new Date(row.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                {' — '}
                {row.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        {shiftSales.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10 px-4">
            {t.posUi.shiftInvoices.empty}
          </p>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-muted/80 z-10">
              <TableRow>
                <TableHead className="text-xs h-8">{t.posUi.endOfDayTime}</TableHead>
                <TableHead className="text-xs h-8">{t.posUi.endOfDayInvoice}</TableHead>
                <TableHead className="text-xs h-8">{t.posUi.shiftInvoices.customer}</TableHead>
                <TableHead className="text-xs h-8 text-right">{t.common.total}</TableHead>
                <TableHead className="text-xs h-8">{t.checkoutUi.paymentForm}</TableHead>
                <TableHead className="text-xs h-8">{t.common.status}</TableHead>
                <TableHead className="text-xs h-8 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shiftSales.map((sale) => {
                const status = resolveShiftSaleStatus(sale, issues);
                const issueHint = issues.find(
                  (row) =>
                    row.saleId === sale.id
                    || (row.invoiceNumber && row.invoiceNumber === sale.invoiceNumber),
                )?.message;
                return (
                  <TableRow key={sale.id} className="text-xs">
                    <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">
                      {new Date(sale.createdAt).toLocaleTimeString(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="py-1.5 font-mono">{sale.invoiceNumber}</TableCell>
                    <TableCell className="py-1.5 max-w-[8rem] truncate" title={sale.customerName || ''}>
                      {sale.customerName?.trim() || t.posUi.walkInCustomer}
                    </TableCell>
                    <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">
                      {sale.total.toLocaleString(locale)} Kz
                    </TableCell>
                    <TableCell className="py-1.5">{paymentLabel(sale.paymentMethod)}</TableCell>
                    <TableCell className="py-1.5">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] font-normal', statusBadgeClass(status))}
                        title={issueHint}
                      >
                        {statusLabel(status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={t.common.view}
                        onClick={() => onViewSale(sale)}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground pt-2 shrink-0">{t.posUi.shiftInvoices.readOnlyHint}</p>
    </div>
  );
}
