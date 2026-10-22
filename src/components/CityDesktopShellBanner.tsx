import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { useCityDesktopShell } from '@/hooks/useCityDesktopShell';

/** One-time desktop shell from the city — cashiers never need a USB installer. */
export function CityDesktopShellBanner() {
  const { t } = useTranslation();
  const {
    needed,
    downloading,
    readyToInstall,
    installing,
    progress,
    error,
    canUseCityIpc,
    startDownload,
    startInstall,
    openInstallerDownload,
  } = useCityDesktopShell();
  if (!needed) return null;

  const busy = downloading || installing;
  const percent = downloading ? t.common.desktopShellDownloading.replace('{percent}', String(progress)) : null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 text-xs bg-sky-500/15 text-sky-950 dark:text-sky-100 border-b border-sky-500/30">
      <span className="font-medium">{t.common.desktopShellTitle}.</span>
      <span className="text-muted-foreground min-w-0">
        {readyToInstall
          ? t.common.desktopShellReady
          : (canUseCityIpc ? t.common.desktopShellDesc : t.common.desktopShellDescManual)}
      </span>
      {downloading ? (
        <span className="font-mono tabular-nums shrink-0">{percent}</span>
      ) : null}
      {readyToInstall ? (
        <Button
          size="sm"
          className="h-6 text-xs shrink-0"
          disabled={busy}
          onClick={() => void startInstall().catch(() => undefined)}
        >
          {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
          {installing ? t.common.updating : t.common.desktopShellInstall}
        </Button>
      ) : (
        <Button size="sm" className="h-6 text-xs shrink-0" disabled={busy} onClick={() => void startDownload()}>
          {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
          {downloading ? (percent || t.common.updating) : t.common.desktopShellAction}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs shrink-0"
        disabled={downloading}
        onClick={() => openInstallerDownload()}
      >
        {t.common.desktopShellSave}
      </Button>
      {error ? (
        <span className="text-destructive">
          {/used by another|in progress|EBUSY|EPERM/i.test(error) ? t.common.desktopShellBusy : error}
        </span>
      ) : null}
    </div>
  );
}
