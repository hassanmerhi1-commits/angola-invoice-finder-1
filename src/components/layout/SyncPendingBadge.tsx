import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CloudOff } from 'lucide-react';
import {
  getOfflinePendingSummary,
  type OfflinePendingItem,
} from '@/lib/sync/offlineSales';
import { useTranslation } from '@/i18n';

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
  },
): string {
  if (items.length === 0) return ui.tooltipWaiting;

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

  const withError = items.find((i) => i.lastError?.trim());
  if (withError?.lastError) {
    return [ui.tooltipFailed.replace('{error}', withError.lastError), ...lines].join('\n');
  }
  return [ui.tooltipWaiting, ...lines].join('\n');
}

export function SyncPendingBadge() {
  const { t, language } = useTranslation();
  const ui = t.syncPendingUi;
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<OfflinePendingItem[]>([]);

  useEffect(() => {
    const tick = async () => {
      const summary = await getOfflinePendingSummary();
      setCount(summary.count);
      setItems(summary.items);
    };
    tick();
    const id = window.setInterval(tick, 10000);
    return () => window.clearInterval(id);
  }, []);

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
        <Badge
          variant="outline"
          className="gap-1 max-w-[220px] cursor-help text-amber-700 border-amber-300"
          title={primaryError || undefined}
        >
          <CloudOff className="h-3 w-3 shrink-0" />
          <span className="truncate">{badgeLabel}</span>
          {primaryError && (
            <span className="truncate text-[10px] opacity-80 hidden sm:inline">
              — {primaryError.slice(0, 40)}{primaryError.length > 40 ? '…' : ''}
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
