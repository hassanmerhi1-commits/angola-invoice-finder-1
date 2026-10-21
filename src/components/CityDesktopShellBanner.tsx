import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { useCityDesktopShell } from '@/hooks/useCityDesktopShell';

/** One-time desktop shell from the city — cashiers never need a USB installer. */
export function CityDesktopShellBanner() {
  const { t } = useTranslation();
  const { needed, downloading, error, canUseCityIpc, startDownload } = useCityDesktopShell();
  if (!needed) return null;
  return (
    <div className="flex items-center justify-center gap-3 px-3 py-1.5 text-xs bg-sky-500/15 text-sky-950 dark:text-sky-100 border-b border-sky-500/30">
      <span className="font-medium">{t.common.desktopShellTitle}.</span>
      <span className="text-muted-foreground min-w-0">
        {canUseCityIpc ? t.common.desktopShellDesc : t.common.desktopShellDescManual}
      </span>
      <Button size="sm" className="h-6 text-xs shrink-0" disabled={downloading} onClick={() => void startDownload()}>
        {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
        {downloading ? t.common.desktopShellDownloading : t.common.desktopShellAction}
      </Button>
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}
