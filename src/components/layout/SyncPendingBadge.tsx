import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CloudOff, Loader2 } from 'lucide-react';
import {
  getOfflinePendingSummary,
  type OfflinePendingItem,
} from '@/lib/sync/offlineSales';
import { useTranslation } from '@/i18n';
import { toast } from 'sonner';

function formatEventLabel(eventType: string, ui: { eventSale: string }): string {
  if (eventType === 'sale.created' || eventType.startsWith('sale')) return ui.eventSale;
  return eventType;
}

function buildTooltip(
  items: OfflinePendingItem[],
  ui: {
    eventSale: string;
    tooltipWaiting: string;
    tooltipFailed: string;
    tooltipItemLine: string;
    tooltipClickSync: string;
  },
): string {
  const header =
    items.length === 0
      ? ui.tooltipWaiting
      : (() => {
          const withError = items.find((i) => i.lastError?.trim());
          if (withError?.lastError) {
            return ui.tooltipFailed.replace('{error}', withError.lastError);
          }
          return ui.tooltipWaiting;
        })();

  const lines = items.slice(0, 4).map((item) => {
    const label = formatEventLabel(item.eventType, ui);
    if (item.lastError) {
      return ui.tooltipItemLine
        .replace('{type}', label)
        .replace('{status}', item.status)
        .replace('{error}', item.lastError);
    }
    return ui.tooltipItemLine
      .replace('{type}', label)
      .replace('{status}', item.status)
      .replace('{error}', '—');
  });

  return [header, ...lines, ui.tooltipClickSync].filter(Boolean).join('\n');
}

export function SyncPendingBadge() {
  const { t, language } = useTranslation();
  const ui = t.syncPendingUi;
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<OfflinePendingItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const summary = await getOfflinePendingSummary();
    setCount(summary.count);
    setItems(summary.items);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleSyncNow = useCallback(async () => {
    const api = (window as any).electronAPI?.syncOutbox;
    if (!api?.flush || syncing) return;
    setSyncing(true);
    try {
      const result = await api.flush();
      await refresh();
      const flushed = Number(result?.flushed ?? 0);
      const pending = Number(result?.pending ?? 0);
      if (flushed > 0) {
        toast.success(ui.syncOk.replace('{n}', String(flushed)));
      } else if (result?.reason === 'server_unreachable' || pending > 0) {
        toast.error(ui.syncStillOffline);
      } else {
        toast.message(ui.syncNothing);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ui.syncStillOffline);
    } finally {
      setSyncing(false);
    }
  }, [refresh, syncing, ui.syncNothing, ui.syncOk, ui.syncStillOffline]);

  const badgeLabel = useMemo(() => {
    if (language === 'pt') {
      return `${count} pendente${count > 1 ? 's' : ''}`;
    }
    return count === 1 ? ui.badgeOne : ui.badgeMany.replace('{count}', String(count));
  }, [count, language, ui.badgeOne, ui.badgeMany]);

  const tooltipText = useMemo(
    () => buildTooltip(items, ui),
    [items, ui],
  );

  const primaryError = items.find((i) => i.lastError?.trim())?.lastError;

  if (count <= 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void handleSyncNow()}
          disabled={syncing}
          className="inline-flex max-w-[220px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={ui.tooltipClickSync}
        >
          <Badge
            variant="outline"
            className="gap-1 max-w-[220px] cursor-pointer text-amber-700 border-amber-300 hover:bg-amber-50"
            title={primaryError || ui.tooltipClickSync}
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <CloudOff className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{badgeLabel}</span>
            {primaryError && (
              <span className="truncate text-[10px] opacity-80 hidden sm:inline">
                — {primaryError.slice(0, 40)}{primaryError.length > 40 ? '…' : ''}
              </span>
            )}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
