import { CloudOff } from 'lucide-react';
import { useOfflineBanner } from '@/hooks/useOfflineBanner';
import { useTranslation } from '@/i18n';

export function OfflineModeBanner() {
  const { t } = useTranslation();
  const { visible, pendingCount } = useOfflineBanner();
  const ui = t.offlineBanner;

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-amber-400 text-amber-950 border-b border-amber-500"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-950" aria-hidden />
      <span>{ui.message}</span>
      {pendingCount > 0 && (
        <span className="rounded-full bg-amber-950/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
          {ui.pendingCount.replace('{count}', String(pendingCount))}
        </span>
      )}
    </div>
  );
}
