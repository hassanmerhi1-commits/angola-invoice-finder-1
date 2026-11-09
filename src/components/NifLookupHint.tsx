import { AlertTriangle, CheckCircle2, Loader2, Info } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import type { NifLookupResult } from '@/lib/api/client';

interface NifLookupHintProps {
  result: NifLookupResult | null;
  loading: boolean;
  currentName?: string;
  replaced?: boolean;
  onUseName?: (name: string) => void;
  className?: string;
}

function sameName(a?: string, b?: string) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function NifLookupHint({ result, loading, currentName, replaced, onUseName, className }: NifLookupHintProps) {
  const { t } = useTranslation();
  const ui = t.nifLookupUi;

  if (loading) {
    return (
      <p className={cn('flex items-center gap-1 text-[11px] text-muted-foreground', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {ui.checking}
      </p>
    );
  }
  if (!result) return null;

  if (result.status === 'found' && result.name) {
    const label = {
      agt: ui.foundAgt,
      cache: ui.foundCache,
      client: ui.foundClient,
      supplier: ui.foundSupplier,
      history: ui.foundHistory,
    }[result.source || 'agt'];
    const official = result.source === 'agt' || result.source === 'cache';
    const differs = Boolean(currentName?.trim()) && !sameName(currentName, result.name);
    return (
      <div className={cn('space-y-0.5 text-[11px]', className)}>
        <p className={cn('flex items-center gap-1', official ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
          {official ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <Info className="h-3 w-3 shrink-0" />}
          <span className="truncate">{label}: <strong>{result.name}</strong></span>
        </p>
        {replaced && <p className="text-muted-foreground">{ui.nameReplaced}</p>}
        {differs && onUseName && (
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => onUseName(result.name!)}
          >
            {ui.useName}
          </button>
        )}
      </div>
    );
  }

  const warning = result.status === 'not_found' || result.status === 'auth_failed' || result.status === 'invalid';
  const message = {
    found: '',
    not_found: ui.notFound,
    not_configured: '',
    unavailable: ui.unavailable,
    auth_failed: ui.authFailed,
    invalid: ui.invalid,
  }[result.status];
  if (!message) return null;
  return (
    <p className={cn('flex items-center gap-1 text-[11px]', warning ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground', className)}>
      {warning ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Info className="h-3 w-3 shrink-0" />}
      {message}
    </p>
  );
}
