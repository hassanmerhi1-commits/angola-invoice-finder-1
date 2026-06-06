import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import type {
  DueBriefingItem,
  LowStockBriefingItem,
  PriceChangeBriefingItem,
  UnprintedBriefingItem,
} from '@/hooks/useDailyBriefing';

function formatKz(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  );
}

type BriefingKind =
  | 'lowStock'
  | 'receivables'
  | 'payables'
  | 'toPrint'
  | 'priceChanges';

interface DailyTodoBriefingListProps {
  kind: BriefingKind;
  loading: boolean;
  error: string | null;
  lowStock?: LowStockBriefingItem[];
  dueItems?: DueBriefingItem[];
  unprinted?: UnprintedBriefingItem[];
  priceChanges?: PriceChangeBriefingItem[];
  onRefresh: () => void;
}

export function DailyTodoBriefingList({
  kind,
  loading,
  error,
  lowStock = [],
  dueItems = [],
  unprinted = [],
  priceChanges = [],
  onRefresh,
}: DailyTodoBriefingListProps) {
  const { t, language } = useTranslation();
  const d = t.dailyTodosUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const navigate = useNavigate();

  const openTarget = () => {
    if (kind === 'lowStock') navigate('/inventory');
    else if (kind === 'toPrint') navigate('/invoices');
    else if (kind === 'priceChanges') navigate('/purchase-invoices');
    else navigate('/payments');
  };

  const openButtonLabel =
    kind === 'lowStock'
      ? d.briefingOpenInventory
      : kind === 'toPrint'
        ? d.briefingOpenInvoices
        : kind === 'priceChanges'
          ? d.briefingOpenPurchaseInvoices
          : d.briefingOpenPayments;

  const dueLabel = (item: DueBriefingItem) => {
    if (item.daysUntilDue === null) return d.briefingNoDueDate;
    if (item.overdue) return d.briefingOverdue;
    if (item.daysUntilDue === 0) return d.briefingDueToday;
    if (item.daysUntilDue > 0) {
      return d.briefingDueIn.replace('{days}', String(item.daysUntilDue));
    }
    return d.briefingOverdue;
  };

  const emptyMessage = (() => {
    if (kind === 'lowStock') return d.briefingEmptyLowStock;
    if (kind === 'toPrint') return d.briefingEmptyToPrint;
    if (kind === 'priceChanges') return d.briefingEmptyPriceChanges;
    if (kind === 'receivables') return d.briefingEmptyReceivables;
    if (kind === 'payables') return d.briefingEmptyPayables;
    return d.briefingEmptyDue;
  })();

  const listCount =
    kind === 'lowStock'
      ? lowStock.length
      : kind === 'toPrint'
        ? unprinted.length
        : kind === 'priceChanges'
          ? priceChanges.length
          : dueItems.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs px-2"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {d.briefingRefresh}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={openTarget}>
          <ExternalLink className="h-3.5 w-3.5" />
          {openButtonLabel}
        </Button>
      </div>

      {kind === 'toPrint' && !loading && unprinted.length > 0 ? (
        <p className="text-xs text-muted-foreground">{d.briefingToPrintHint}</p>
      ) : null}

      {error && (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="max-h-[min(42vh,320px)] overflow-y-auto pr-1 space-y-1.5">
        {loading && listCount === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{d.briefingLoading}</p>
        ) : null}

        {!loading && listCount === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</p>
        ) : null}

        {kind === 'lowStock' &&
          lowStock.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={openTarget}
              className="flex w-full items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <Package className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.sku ? `${item.sku} · ` : ''}
                  {d.briefingStock
                    .replace('{stock}', String(item.stock))
                    .replace('{min}', String(item.minStock))}
                  {item.unit ? ` ${item.unit}` : ''}
                </p>
              </div>
            </button>
          ))}

        {kind === 'toPrint' &&
          unprinted.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate('/invoices')}
              className="flex w-full items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <Printer className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.documentNumber}</p>
                <p className="text-xs text-muted-foreground truncate">{item.customerName}</p>
                <p className="text-xs font-semibold mt-0.5">{formatKz(item.total, locale)} Kz</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-xs font-normal">
                {d.briefingNotPrinted}
              </Badge>
            </button>
          ))}

        {kind === 'priceChanges' &&
          priceChanges.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate('/purchase-invoices')}
              className="flex w-full items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <Tag className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.documentNumber}</p>
                <p className="text-xs text-muted-foreground truncate">{item.supplierName}</p>
                <p className="text-xs text-muted-foreground">{item.date}</p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-xs font-normal">
                {d.briefingPricesUpdated}
              </Badge>
            </button>
          ))}

        {(kind === 'receivables' || kind === 'payables') &&
          dueItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={openTarget}
              className="flex w-full items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.entityName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.documentNumber}
                  {item.documentDate ? ` · ${item.documentDate}` : ''}
                </p>
                <p className="text-xs font-semibold mt-0.5">{formatKz(item.amount, locale)} Kz</p>
              </div>
              <Badge
                variant={item.overdue ? 'destructive' : 'secondary'}
                className="shrink-0 text-xs font-normal"
              >
                {dueLabel(item)}
              </Badge>
            </button>
          ))}
      </div>
    </div>
  );
}
