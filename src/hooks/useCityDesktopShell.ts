import { useCallback, useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api/config';

type Latest = {
  ok?: boolean;
  ready?: boolean;
  buildId?: string;
  file?: string;
  size?: number;
};

function sameBuild(a?: string | null, b?: string | null) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return !!left && !!right && left === right;
}

function isBusyError(message: string) {
  return /being used by another|used by another program|EBUSY|EPERM|EACCES|in progress/i.test(message);
}

export function useCityDesktopShell() {
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
  const [needed, setNeeded] = useState(false);
  const [readyOnCity, setReadyOnCity] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [readyToInstall, setReadyToInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('NEXOR-ERP-1.3.8-x64.exe');
  const canUseCityIpc = typeof window !== 'undefined'
    && typeof (window as any).electronAPI?.updater?.downloadCityShell === 'function';

  const fileUrl = () => `${getApiUrl().replace(/\/$/, '')}/api/desktop-shell/file`;

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      const base = getApiUrl().replace(/\/$/, '');
      const res = await fetch(`${base}/api/desktop-shell/latest`, { cache: 'no-store' });
      const latest = (await res.json()) as Latest;
      if (!latest?.ready || !latest.buildId) {
        setReadyOnCity(false);
        setNeeded(false);
        return;
      }
      setReadyOnCity(true);
      if (latest.file) setFileName(latest.file);
      const diag = await (window as any).electronAPI?.updater?.getDiagnostics?.();
      const hasCache = diag?.hasCityUiCache === true;
      const current = diag?.shellBuildId || null;
      setNeeded(!hasCache || !sameBuild(current, latest.buildId));
    } catch {
      setReadyOnCity(false);
    }
  }, [isElectron]);

  useEffect(() => {
    if (!isElectron) return;
    const start = window.setTimeout(() => { void refresh(); }, 8000);
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [isElectron, refresh]);

  useEffect(() => {
    if (!isElectron) return undefined;
    const updater = (window as any).electronAPI?.updater;
    if (!updater?.onStatus) return undefined;
    const unsubscribe = updater.onStatus((data: { status?: string; progress?: number }) => {
      if (!data || typeof data !== 'object') return;
      if (data.status === 'downloading') {
        setDownloading(true);
        setProgress(Math.max(0, Math.min(100, Math.round(Number(data.progress) || 0))));
      }
      if (data.status === 'downloaded') {
        setDownloading(false);
        setProgress(100);
        setReadyToInstall(true);
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isElectron]);

  const openInstallerDownload = useCallback(() => {
    const url = fileUrl();
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noreferrer';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [fileName]);

  const startInstall = useCallback(async () => {
    setError(null);
    setInstalling(true);
    try {
      const result = await (window as any).electronAPI?.updater?.install?.();
      if (result?.success) return;
      const message = String(result?.error || 'Install failed');
      if (isBusyError(message)) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        const retry = await (window as any).electronAPI?.updater?.install?.();
        if (retry?.success) return;
        throw new Error(retry?.error || message);
      }
      throw new Error(message);
    } catch (err) {
      setInstalling(false);
      const message = err instanceof Error ? err.message : 'Install failed';
      setError(isBusyError(message)
        ? message
        : message);
      throw err;
    }
  }, []);

  const startDownload = useCallback(async () => {
    setError(null);
    setDownloading(true);
    setProgress(0);
    try {
      if (canUseCityIpc) {
        const result = await (window as any).electronAPI.updater.downloadCityShell();
        if (!result?.success) throw new Error(result?.error || 'Download failed');
        if (result.alreadyCurrent) {
          setNeeded(false);
          return;
        }
        setReadyToInstall(true);
        setProgress(100);
        try {
          await startInstall();
        } catch {
          /* banner keeps Install now */
        }
        return;
      }
      openInstallerDownload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }, [canUseCityIpc, openInstallerDownload, startInstall]);

  return {
    needed: isElectron && needed && readyOnCity,
    downloading,
    readyToInstall,
    installing,
    progress,
    error,
    canUseCityIpc,
    startDownload,
    startInstall,
    openInstallerDownload,
  };
}
