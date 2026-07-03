import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Download,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import type { HotUpdateConfig, UpdateStatus } from '@/types/electron';

export function PosUpdateMenu() {
  const { t } = useTranslation();
  const ui = t.posUi.updates;
  const isElectron = !!window.electronAPI?.isElectron;

  const [open, setOpen] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  const [hotUpdateConfig, setHotUpdateConfig] = useState<HotUpdateConfig | null>(null);
  const [loadSource, setLoadSource] = useState<'server' | 'local' | 'unknown'>('unknown');
  const [reloadingUi, setReloadingUi] = useState(false);

  useEffect(() => {
    if (!isElectron) return;

    void window.electronAPI?.updater.getVersion().then((v: unknown) => {
      const version = typeof v === 'string' ? v : (v as { version?: string })?.version;
      setAppVersion(typeof version === 'string' ? version : '');
    });

    void window.electronAPI?.updater.getState?.().then((state) => {
      if (state?.status === 'downloaded' && state.version) {
        setUpdateStatus({ status: 'downloaded', version: state.version });
      }
    });

    void window.electronAPI?.hotUpdate?.getConfig().then((result) => {
      if (result?.success && result.config) {
        setHotUpdateConfig(result.config);
      }
    });

    void window.electronAPI?.hotUpdate?.getSource().then((result) => {
      if (result?.success && result.source) {
        setLoadSource(result.source);
      }
    });

    const unsubscribe = window.electronAPI?.updater.onStatus((data) => {
      setUpdateStatus(data);
      setIsChecking(data.status === 'checking');
      if (data.status === 'downloading') {
        setIsDownloading(true);
      } else if (data.status === 'downloaded') {
        setIsDownloading(false);
        setInstallDialogOpen(true);
      } else if (data.status === 'error' || data.status === 'not-available' || data.status === 'available') {
        setIsDownloading(false);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isElectron]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!isElectron) return;
    setIsChecking(true);
    setUpdateStatus({ status: 'checking' });
    try {
      const result = await window.electronAPI?.updater.check();
      if (!result?.success) {
        const error = result?.error || ui.checkFailed;
        setUpdateStatus({ status: 'error', error });
        toast.error(ui.checkFailed, { description: error });
        return;
      }
      if (result.alreadyDownloaded && result.version) {
        setUpdateStatus({ status: 'downloaded', version: result.version });
        setInstallDialogOpen(true);
      } else if (result.isUpdateAvailable && result.version) {
        setUpdateStatus({ status: 'available', version: result.version });
        toast.info(ui.updateAvailable.replace('{version}', result.version));
      } else {
        setUpdateStatus({ status: 'not-available' });
        toast.success(ui.upToDate);
      }
    } catch {
      setUpdateStatus({ status: 'error', error: ui.checkFailed });
      toast.error(ui.checkFailed);
    } finally {
      setIsChecking(false);
    }
  }, [isElectron, ui]);

  const handleDownloadUpdate = useCallback(async () => {
    if (!isElectron) return;
    setIsDownloading(true);
    setUpdateStatus({ status: 'downloading', progress: 0 });
    try {
      const result = await window.electronAPI?.updater.download();
      if (result?.success) {
        setUpdateStatus({
          status: 'downloaded',
          version: (result as { version?: string }).version,
        });
        setInstallDialogOpen(true);
        return;
      }
      const errText = result?.error || ui.downloadFailed;
      setUpdateStatus({ status: 'error', error: errText });
      toast.error(ui.downloadFailed, { description: errText });
    } catch {
      setUpdateStatus({ status: 'error', error: ui.downloadFailed });
      toast.error(ui.downloadFailed);
    } finally {
      setIsDownloading(false);
    }
  }, [isElectron, ui]);

  const handleInstallUpdate = useCallback(async () => {
    setInstalling(true);
    try {
      const result = await window.electronAPI?.updater.install();
      if (result && !result.success) {
        toast.error(result.error || ui.installFailed);
      }
    } catch {
      toast.error(ui.installFailed);
    } finally {
      setInstalling(false);
    }
  }, [ui]);

  const handleReloadUi = useCallback(async () => {
    setReloadingUi(true);
    try {
      const result = await window.electronAPI?.hotUpdate?.reload();
      if (result?.success) {
        toast.success(
          t.hotUpdateUi.reloadingFrom.replace('{source}', result.source || 'server'),
        );
      } else {
        toast.error(result?.error || t.hotUpdateUi.reloadFailed);
      }
    } catch {
      toast.error(t.hotUpdateUi.reloadFailed);
    } finally {
      setReloadingUi(false);
    }
  }, [t]);

  if (!isElectron) return null;

  const hotUpdateEnabled = !!hotUpdateConfig?.enabled && !!hotUpdateConfig.serverUrl?.trim();
  const showDownload =
    updateStatus?.status === 'available' && !isDownloading;
  const showInstall =
    updateStatus?.status === 'downloaded' && !installing;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs gap-1.5 shrink-0"
            title={ui.title}
          >
            <Download className="w-3.5 h-3.5" />
            {ui.button}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-sm">{ui.title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{ui.description}</p>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{ui.currentVersion}</span>
              <Badge variant="outline">{appVersion || '—'}</Badge>
            </div>

            {updateStatus?.status === 'available' && updateStatus.version && (
              <Badge variant="default" className="gap-1">
                <Download className="w-3 h-3" />
                {ui.updateAvailable.replace('{version}', updateStatus.version)}
              </Badge>
            )}
            {updateStatus?.status === 'downloaded' && (
              <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                <CheckCircle2 className="w-3 h-3" />
                {ui.readyToInstall}
              </Badge>
            )}
            {updateStatus?.status === 'not-available' && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {ui.upToDate}
              </Badge>
            )}
            {updateStatus?.status === 'error' && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {updateStatus.error || ui.checkFailed}
              </p>
            )}

            {updateStatus?.status === 'downloading' && updateStatus.progress !== undefined && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{ui.downloading}</span>
                  <span>{Math.round(updateStatus.progress)}%</span>
                </div>
                <Progress value={updateStatus.progress} className="h-1.5" />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={isChecking || isDownloading}
                onClick={() => void handleCheckForUpdates()}
              >
                {isChecking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {isChecking ? ui.checking : ui.checkForUpdates}
              </Button>

              {showDownload && (
                <Button
                  type="button"
                  size="sm"
                  className="w-full justify-start gap-2"
                  disabled={isDownloading}
                  onClick={() => void handleDownloadUpdate()}
                >
                  <Download className="w-4 h-4" />
                  {ui.downloadUpdate}
                </Button>
              )}

              {showInstall && (
                <Button
                  type="button"
                  size="sm"
                  className="w-full justify-start gap-2"
                  disabled={installing}
                  onClick={() => setInstallDialogOpen(true)}
                >
                  {installing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {ui.installAndRestart}
                </Button>
              )}
            </div>

            {hotUpdateEnabled && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{ui.uiSource}</span>
                    <Badge variant={loadSource === 'server' ? 'default' : 'secondary'}>
                      {loadSource === 'server' ? ui.fromServer : ui.fromLocal}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start gap-2"
                    disabled={reloadingUi}
                    onClick={() => void handleReloadUi()}
                  >
                    {reloadingUi ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    {ui.reloadUiFromServer}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">{ui.reloadUiHint}</p>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={installDialogOpen}
        onOpenChange={(next) => {
          if (!installing) setInstallDialogOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ui.installDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {updateStatus?.version
                ? ui.installDialogDesc.replace('{version}', updateStatus.version)
                : ui.installDialogDescGeneric}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={installing}>{ui.later}</AlertDialogCancel>
            <AlertDialogAction
              disabled={installing}
              onClick={(e) => {
                e.preventDefault();
                void handleInstallUpdate();
              }}
            >
              {installing ? ui.installing : ui.installAndRestart}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
