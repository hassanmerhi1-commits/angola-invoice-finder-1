import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

/** Loading / error / empty line for stock reports — never leave the user on a silent blank table. */
export function ReportStockStatus({
  loading,
  error,
  empty,
  emptyHint,
  onRetry,
  errorMessage,
  loadingMessage,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyHint?: string;
  onRetry: () => void;
  /** Non-stock reports pass their own wording; `{error}` is replaced with the server message. */
  errorMessage?: string;
  loadingMessage?: string;
}) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">{(errorMessage || t.stockValuationUi.loadFailed).replace('{error}', error)}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          {t.common.retry}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {loadingMessage || t.stockValuationUi.loadingStock}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        {emptyHint || t.common.noResults}
      </div>
    );
  }

  return null;
}
