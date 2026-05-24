import { useState, useEffect, useCallback } from 'react';
import { getApiUrl, getApiUrlAsync, isWebPreview } from '@/lib/api/config';
import { electronAwareJsonRequest } from '@/lib/electronHttp';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Database, Server, RefreshCw, CheckCircle2, XCircle, Container, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';

interface HealthData {
  status?: string;
  ok?: boolean;
  serverName?: string;
  version?: string;
  connectedClients?: number;
  database?: {
    connected: boolean;
    latency: number | null;
    version: string | null;
    database: string | null;
    serverAddr: string | null;
    serverPort: number | null;
    serverTime: string | null;
  };
  system?: {
    hostname: string;
    platform: string;
    uptime: number;
    nodeVersion: string;
  };
}

interface ElectronStatus {
  mode: 'server' | 'client' | 'unconfigured';
  connected: boolean;
  path: string | null;
  serverAddress: string | null;
}

const isElectron = !!(window as any).electronAPI?.db;

export function ServerConnectionIndicator() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [backendReachable, setBackendReachable] = useState(false);
  const [electronStatus, setElectronStatus] = useState<ElectronStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    setIsChecking(true);
    try {
      if (isElectron) {
        const api = (window as any).electronAPI;
        if (api?.db?.ensureBackend) {
          await api.db.ensureBackend().catch(() => null);
        }
        // Desktop mode: use Electron IPC directly
        const status = await api.db.getStatus();
        let latestStatus = status;
        if (status?.success !== false) {
          setElectronStatus(status);
          const expressOk = !!(status.expressBackend || status.expressPort);
          setBackendReachable(
            status.connected
            || expressOk
            || status.mode === 'server'
            || status.mode === 'client'
            || status.mode === 'standalone'
          );
        } else {
          setElectronStatus(null);
          setBackendReachable(false);
        }
        // Also try the Express backend for extra info
        try {
          const apiUrl = await getApiUrlAsync({ waitForPortMs: 10000 });
          const res = await electronAwareJsonRequest(`${new URL(apiUrl).origin}/api/health`, {
            timeoutMs: 5000,
          });
          if (res.ok && res.json) {
            setHealth(res.json as HealthData);
            setBackendReachable(true);
            if (latestStatus?.success !== false) {
              latestStatus = { ...latestStatus, connected: true, expressBackend: true };
              setElectronStatus(latestStatus);
            }
          }
        } catch {
          // Express backend not running - that's fine in desktop mode
        }
      } else {
        // Web mode: use HTTP fetch
        const apiUrl = getApiUrl();
        const parsedUrl = (() => {
          try { return new URL(apiUrl); } catch { return new URL(`http://${apiUrl.replace(/^https?:\/\//, '')}`); }
        })();

        const response = await fetch(`${parsedUrl.origin}/api/health`, {
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = await response.json();
          setHealth(data);
          setBackendReachable(true);
        } else {
          setBackendReachable(false);
          setHealth(null);
        }
      }
    } catch {
      setBackendReachable(false);
      setHealth(null);
      setElectronStatus(null);
    } finally {
      setIsChecking(false);
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    // Skip polling in web preview mode (no backend available)
    if (!isElectron && isWebPreview()) return;

    checkHealth();
    const interval = setInterval(checkHealth, 15000);

    const api = (window as any).electronAPI;
    if (api?.backend?.onStatus) {
      api.backend.onStatus((data: { state?: string }) => {
        if (data?.state === 'healthy' || data?.state === 'restarted') {
          checkHealth();
        }
      });
    }

    return () => clearInterval(interval);
  }, [checkHealth]);

  // Determine overall status
  const dbConnected = isElectron
    ? !!(
        electronStatus?.connected
        || electronStatus?.expressBackend
        || (health?.ok === true && health?.unified === true)
        || (electronStatus?.mode === 'client' && backendReachable && health?.ok === true)
      )
    : (health?.database?.connected ?? health?.ok ?? false);
  
  const systemReachable = isElectron
    ? (
        electronStatus?.mode === 'server'
        || electronStatus?.mode === 'client'
        || electronStatus?.mode === 'standalone'
      )
    : backendReachable;

  const allGood = systemReachable && dbConnected;

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const modeLabel = isElectron
    ? (
        electronStatus?.mode === 'server'
          ? 'Servidor'
          : electronStatus?.mode === 'client'
            ? 'Cliente'
            : electronStatus?.mode === 'standalone'
              ? 'Local'
              : 'N/A'
      )
    : 'Web';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={checkHealth}
            disabled={isChecking}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all",
              allGood
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : systemReachable
                  ? "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            {isChecking ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                {isElectron ? (
                  <Monitor className={cn("w-3.5 h-3.5", allGood ? "text-emerald-500" : systemReachable ? "text-orange-500" : "text-destructive")} />
                ) : (
                  <Container className={cn("w-3.5 h-3.5", allGood ? "text-emerald-500" : systemReachable ? "text-orange-500" : "text-destructive")} />
                )}
                
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  allGood ? "bg-emerald-500 animate-pulse" : systemReachable ? "bg-orange-500" : "bg-destructive"
                )} />

                <Database className={cn("w-3.5 h-3.5", dbConnected ? "text-emerald-500" : "text-destructive")} />
              </>
            )}

            <span className="hidden sm:inline">
              {isChecking ? t.connectionUi.checking : allGood ? t.connectionUi.connected : systemReachable ? t.connectionUi.dbOffline : t.connectionUi.disconnected}
            </span>

            {health?.database?.latency != null && (
              <span className="text-[10px] opacity-70">{health.database.latency}ms</span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm p-0 overflow-hidden">
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4" />
              <span className="font-semibold text-sm">{t.connectionUi.connectionStatus}</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{modeLabel}</Badge>
            </div>

            {/* Electron Desktop Status */}
            {isElectron && electronStatus && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Monitor className="w-3 h-3" />
                    Desktop → SQLite
                  </span>
                  {dbConnected ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> {t.connectionUi.connected}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                      <XCircle className="w-3 h-3 mr-1" /> {t.connectionUi.disconnected}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3 h-3" />
                    {t.connectionUi.mode}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {electronStatus.mode === 'server'
                      ? `🖥️ ${t.connectionUi.server}`
                      : electronStatus.mode === 'client'
                        ? `💻 ${t.connectionUi.client}`
                        : electronStatus.mode === 'standalone'
                          ? '📁 Local'
                          : '❓ N/A'}
                  </Badge>
                </div>
              </div>
            )}

            {/* Web / Express Backend Status */}
            {!isElectron && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3 h-3" />
                    {t.connectionUi.backendServer}
                  </span>
                  {backendReachable ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> {t.connectionUi.online}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                      <XCircle className="w-3 h-3 mr-1" /> {t.connectionUi.offline}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Container className="w-3 h-3" />
                    Backend → SQLite
                  </span>
                  {health?.database?.connected ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> {t.connectionUi.connected}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                      <XCircle className="w-3 h-3 mr-1" /> {t.connectionUi.disconnected}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Details */}
            {health && (
              <div className="border-t pt-2 space-y-1 text-[11px] text-muted-foreground">
                {health.database?.database && (
                  <p><strong>{t.connectionUi.database}:</strong> {health.database.database}</p>
                )}
                {health.database?.serverAddr && (
                  <p><strong>{t.connectionUi.dbServer}:</strong> {health.database.serverAddr}:{health.database.serverPort}</p>
                )}
                {health.database?.latency != null && (
                  <p><strong>{t.connectionUi.latency}:</strong> {health.database.latency}ms</p>
                )}
                {health.system && (
                  <>
                    <p><strong>{t.connectionUi.host}:</strong> {health.system.hostname} ({health.system.platform})</p>
                    <p><strong>{t.connectionUi.uptime}:</strong> {formatUptime(health.system.uptime)}</p>
                  </>
                )}
                <p><strong>{t.connectionUi.connectedClients}:</strong> {health.connectedClients}</p>
              </div>
            )}

            {isElectron && electronStatus?.path && (
              <div className="border-t pt-2 text-[11px] text-muted-foreground">
                <p><strong>{t.connectionUi.connection}:</strong> <code className="text-[10px] bg-muted px-1 rounded">SQLite local (.nexor/.db)</code></p>
              </div>
            )}

            {!isElectron && !backendReachable && (
              <div className="border-t pt-2 text-[11px] text-muted-foreground space-y-1">
                <p className="font-medium text-destructive">{t.connectionUi.serverNotAccessible}</p>
                <p>{t.connectionUi.checkBackendRunning}</p>
                <p className="font-mono text-[10px] bg-muted p-1 rounded">cd backend && npm run dev</p>
              </div>
            )}

            {lastChecked && (
              <p className="text-[10px] text-muted-foreground/60 pt-1">
                {t.connectionUi.lastCheck.replace('{time}', lastChecked.toLocaleTimeString())}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
