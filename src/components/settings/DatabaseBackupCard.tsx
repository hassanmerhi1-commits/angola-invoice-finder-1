import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  Download,
  Upload,
  Loader2,
  Trash2,
  RefreshCw,
  AlertTriangle,
  HardDrive,
} from 'lucide-react';
import { toast } from 'sonner';
import { isDemoMode } from '@/lib/api/config';
import {
  BackupApiError,
  createDatabaseBackup,
  deleteDatabaseBackup,
  downloadDatabaseBackup,
  fetchBackupInfo,
  formatBytes,
  listDatabaseBackups,
  probeBackupApi,
  restoreDatabaseBackupByName,
  restoreDatabaseBackupFile,
  type BackupConnectionIssue,
  type BackupFileEntry,
  type BackupInfo,
} from '@/lib/api/backup';
import { invalidateElectronApiBaseCache } from '@/lib/api/config';
import { downloadBackup, parseBackupFile, restoreBackup, getStorageStats } from '@/lib/backup';
import { clearLocalErpCache } from '@/lib/clearLocalErpCache';

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'pt' ? 'pt-AO' : 'en-GB');
  } catch {
    return iso;
  }
}

export function DatabaseBackupCard() {
  const { t, language } = useTranslation();
  const ui = t.databaseBackupUi;
  const uploadRef = useRef<HTMLInputElement>(null);
  const prefsUploadRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [backups, setBackups] = useState<BackupFileEntry[]>([]);
  const [prefsStats, setPrefsStats] = useState(() => getStorageStats());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState<BackupConnectionIssue | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [apiBaseTried, setApiBaseTried] = useState<string | null>(null);

  const locale = language === 'pt' ? 'pt' : 'en';
  const isElectron = !!window.electronAPI?.isElectron;
  const demo = isDemoMode();

  const issueMessage = (issue: BackupConnectionIssue | null): string => {
    switch (issue) {
      case 'offline':
        return ui.errorOffline;
      case 'timeout':
        return ui.errorTimeout;
      case 'not_found':
        return ui.errorNotFound;
      case 'server_error':
        return ui.errorServer;
      case 'demo':
        return ui.demoUnavailable;
      default:
        return ui.backendUnavailable;
    }
  };

  const refresh = useCallback(async (forceReconnect = false) => {
    if (demo) {
      setBackendUnavailable(true);
      setConnectionIssue('demo');
      setLastError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (forceReconnect) invalidateElectronApiBaseCache();
    try {
      const probe = await probeBackupApi();
      setApiBaseTried(probe.base);
      const [backupInfo, list] = await Promise.all([fetchBackupInfo(), listDatabaseBackups()]);
      setInfo(backupInfo);
      setBackups(list);
      setBackendUnavailable(false);
      setConnectionIssue(null);
      setLastError(null);
    } catch (e: unknown) {
      setBackendUnavailable(true);
      setInfo(null);
      setBackups([]);
      if (e instanceof BackupApiError) {
        setConnectionIssue(e.issue);
        setLastError(e.message);
        setApiBaseTried(e.apiBase ?? null);
      } else {
        setConnectionIssue('unknown');
        setLastError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [demo, ui]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createDatabaseBackup();
      let description = `${result.filename} (${formatBytes(result.size)})`;
      if (typeof result.offsiteCopy === 'string' && result.offsiteCopy) {
        description = `${description}. ${ui.offsiteCopyOk}`;
      } else if (result.offsiteCopy && typeof result.offsiteCopy === 'object' && 'error' in result.offsiteCopy) {
        description = `${description}. ${ui.offsiteCopyFailed.replace('{error}', result.offsiteCopy.error)}`;
      }
      toast.success(ui.backupCreated, { description });
      await refresh();
    } catch (e: unknown) {
      toast.error(ui.backupFailed, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      await downloadDatabaseBackup(filename);
      toast.success(ui.downloadStarted, { description: filename });
    } catch (e: unknown) {
      toast.error(ui.downloadFailed, { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDelete = async (filename: string) => {
    if (!window.confirm(ui.confirmDelete.replace('{name}', filename))) return;
    try {
      await deleteDatabaseBackup(filename);
      toast.success(ui.deleted);
      await refresh();
    } catch (e: unknown) {
      toast.error(ui.deleteFailed, { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const afterRestore = async (requiresRestart?: boolean) => {
    await refresh();
    if (requiresRestart && isElectron && window.electronAPI?.app?.relaunch) {
      toast.info(ui.restartingApp);
      setTimeout(() => void window.electronAPI!.app.relaunch(), 1200);
      return;
    }
    toast.success(ui.restoreDone, { description: ui.reloadHint });
    setTimeout(() => window.location.reload(), 1500);
  };

  const handleRestoreUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = info?.backupExtension || '.db';
    if (!file.name.toLowerCase().endsWith(ext)) {
      toast.error(ui.wrongFileType.replace('{ext}', ext));
      if (uploadRef.current) uploadRef.current.value = '';
      return;
    }
    if (!window.confirm(ui.confirmRestoreUpload.replace('{name}', file.name))) {
      if (uploadRef.current) uploadRef.current.value = '';
      return;
    }
    setRestoring(true);
    try {
      const result = await restoreDatabaseBackupFile(file);
      await afterRestore(result.requiresRestart);
    } catch (err: unknown) {
      toast.error(ui.restoreFailed, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setRestoring(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const handleRestoreByName = async (filename: string) => {
    if (!window.confirm(ui.confirmRestoreNamed.replace('{name}', filename))) return;
    setRestoring(true);
    try {
      const result = await restoreDatabaseBackupByName(filename);
      await afterRestore(result.requiresRestart);
    } catch (e: unknown) {
      toast.error(ui.restoreFailed, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRestoring(false);
    }
  };

  const handleClearLocalCache = () => {
    const { removed } = clearLocalErpCache();
    setPrefsStats(getStorageStats());
    toast.success(ui.clearLocalCacheDone.replace('{count}', String(removed)));
    window.location.reload();
  };

  const handlePrefsBackup = () => {
    downloadBackup();
    setPrefsStats(getStorageStats());
    toast.success(ui.prefsBackupCreated, {
      description: `${prefsStats.keys} ${ui.prefsItems} (${prefsStats.sizeKB} KB)`,
    });
  };

  const handlePrefsRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const backup = await parseBackupFile(file);
      if (
        !window.confirm(
          ui.confirmPrefsRestore
            .replace('{date}', formatDate(backup.metadata.createdAt, locale))
            .replace('{count}', String(backup.metadata.itemCount))
        )
      ) {
        return;
      }
      restoreBackup(backup);
      setPrefsStats(getStorageStats());
      toast.success(ui.prefsRestored);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: unknown) {
      toast.error(ui.prefsRestoreFailed, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      if (prefsUploadRef.current) prefsUploadRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            {ui.databaseTitle}
          </CardTitle>
          <CardDescription>{ui.databaseDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {demo && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {ui.demoUnavailable}
            </div>
          )}

          {backendUnavailable && !demo && (
            <div className="space-y-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p>{issueMessage(connectionIssue)}</p>
                  {lastError && (
                    <p className="text-xs opacity-90 font-mono break-all">{lastError}</p>
                  )}
                  {apiBaseTried && (
                    <p className="text-xs opacity-80">
                      {ui.triedUrl}: <span className="font-mono">{apiBaseTried}</span>
                    </p>
                  )}
                  <p className="text-xs opacity-80">{ui.restartHint}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-destructive/30"
                onClick={() => refresh(true)}
                disabled={loading}
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
                {ui.retryConnection}
              </Button>
            </div>
          )}

          {info && !backendUnavailable && (
            <div className="space-y-2 p-3 rounded-lg bg-accent/50 text-sm">
              <p className="text-muted-foreground">
                {info.offsiteDirConfigured ? ui.offsiteConfigured : ui.offsiteNotConfigured}
              </p>
              {info.restoreRtoHint && (
                <p className="text-muted-foreground text-xs">{ui.restoreRtoHint}</p>
              )}
              <p className="text-muted-foreground">
                {info.autoBackup?.enabled
                  ? ui.autoBackupOn.replace('{keep}', String(info.autoBackup.keep ?? 14))
                  : ui.autoBackupOff}
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="secondary">{info.engine.toUpperCase()}</Badge>
                {info.databaseSize != null && (
                  <span className="text-muted-foreground">
                    {ui.liveDbSize}: {formatBytes(info.databaseSize)}
                  </span>
                )}
              </div>
              {info.databasePath && (
                <p className="text-xs text-muted-foreground break-all font-mono">{info.databasePath}</p>
              )}
              <p className="text-[10px] text-muted-foreground">{ui.backupFolder}: {info.backupDir}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              onClick={handleCreate}
              variant="default"
              className="gap-2 h-12"
              disabled={creating || loading || backendUnavailable || demo || info?.restoreInProgress}
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {ui.createDatabaseBackup}
            </Button>
            <div>
              <input
                ref={uploadRef}
                type="file"
                accept={info?.backupExtension || '.db'}
                onChange={handleRestoreUpload}
                className="hidden"
              />
              <Button
                onClick={() => uploadRef.current?.click()}
                variant="outline"
                className="gap-2 h-12 w-full"
                disabled={restoring || loading || backendUnavailable || demo}
              >
                {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {ui.restoreFromFile}
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground">{ui.databaseHint}</p>

          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{ui.savedBackups}</p>
            <Button variant="ghost" size="sm" onClick={() => refresh(true)} disabled={loading} className="gap-1 h-8">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {ui.refresh}
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{ui.noBackups}</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {backups.map((b) => (
                <li
                  key={b.filename}
                  className="flex flex-wrap items-center gap-2 justify-between p-2 rounded-md border text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs truncate">{b.filename}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(b.createdAt, locale)} · {formatBytes(b.size)}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="outline" size="sm" className="h-8" onClick={() => handleDownload(b.filename)}>
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={restoring}
                      onClick={() => handleRestoreByName(b.filename)}
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => handleDelete(b.filename)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="w-4 h-4" />
            {ui.prefsTitle}
          </CardTitle>
          <CardDescription>{ui.prefsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {prefsStats.keys} {ui.prefsItems} · {prefsStats.sizeKB} KB
          </p>
          <p className="text-[10px] text-muted-foreground">{ui.clearLocalCacheHint}</p>
          <Button
            type="button"
            variant="secondary"
            className="gap-2 h-10 w-full"
            onClick={handleClearLocalCache}
          >
            <Trash2 className="w-4 h-4" />
            {ui.clearLocalCache}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={handlePrefsBackup} variant="outline" className="gap-2 h-10">
              <Download className="w-4 h-4" />
              {ui.exportPrefs}
            </Button>
            <div>
              <input
                ref={prefsUploadRef}
                type="file"
                accept=".json"
                onChange={handlePrefsRestore}
                className="hidden"
              />
              <Button
                onClick={() => prefsUploadRef.current?.click()}
                variant="outline"
                className="gap-2 h-10 w-full"
              >
                <Upload className="w-4 h-4" />
                {ui.importPrefs}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
