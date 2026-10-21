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

export function useCityDesktopShell() {
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
  const [needed, setNeeded] = useState(false);
  const [readyOnCity, setReadyOnCity] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('NEXOR-ERP-1.3.8-x64.exe');
  const canUseCityIpc = typeof window !== 'undefined'
    && typeof (window as any).electronAPI?.updater?.downloadCityShell === 'function';

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

  const startDownload = useCallback(async () => {
    setError(null);
    setDownloading(true);
    try {
      if (canUseCityIpc) {
        const result = await (window as any).electronAPI.updater.downloadCityShell();
        if (!result?.success) throw new Error(result?.error || 'Download failed');
        setNeeded(false);
        return;
      }
      const base = getApiUrl().replace(/\/$/, '');
      const a = document.createElement('a');
      a.href = `${base}/api/desktop-shell/file`;
      a.download = fileName;
      a.rel = 'noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }, [canUseCityIpc, fileName]);

  return {
    needed: isElectron && needed && readyOnCity,
    downloading,
    error,
    canUseCityIpc,
    startDownload,
  };
}
