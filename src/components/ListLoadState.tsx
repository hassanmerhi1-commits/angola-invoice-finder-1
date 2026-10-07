import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

/**
 * Stands in for a list's empty state so a failed request stops looking like a
 * day with no records. Call sites keep their own "nothing here" markup as
 * children; this only takes over while loading or after a failure.
 */
export function ListLoadState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin opacity-70" />
        <p className="text-sm">{t.common.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle className="h-7 w-7 text-amber-600" />
        <p className="max-w-md text-sm text-muted-foreground">{t.common.loadFailed}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t.common.retry}
          </Button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
