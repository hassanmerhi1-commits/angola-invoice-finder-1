import { useState, useEffect, useCallback } from 'react';
import { getApiUrl, isWebPreview } from '@/lib/api/config';

export interface DatabaseStatus {
  isConnected: boolean;
  isServer: boolean;
  databasePath: string | null;
  serverIp: string | null;
  serverPort: number;
  mode: 'server' | 'client' | 'local' | 'unknown';
  lastChecked: Date | null;
}

export function useDatabaseStatus() {
  const [status, setStatus] = useState<DatabaseStatus>({
    isConnected: false,
    isServer: false,
    databasePath: null,
    serverIp: null,
    serverPort: 3000,
    mode: 'unknown',
    lastChecked: null,
  });
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    
    try {
      // Check if running in Electron
      const isElectron = !!window.electronAPI?.isElectron;

      // In Electron, IPC DB status is the most reliable source of truth.
      // It knows whether main-process PG/ws connectivity is alive, while
      // HTTP health checks can fail transiently during backend port changes.
      if (isElectron && window.electronAPI?.db?.getStatus) {
        try {
          const dbStatus = await window.electronAPI.db.getStatus();
          if (dbStatus?.success) {
            const mode =
              dbStatus.mode === 'server'
              || dbStatus.mode === 'client'
              || dbStatus.mode === 'standalone'
              ? dbStatus.mode
              : 'unknown';
            const parsedPath = typeof dbStatus.path === 'string' ? dbStatus.path : null;
            const parsedServerAddress = typeof dbStatus.serverAddress === 'string' ? dbStatus.serverAddress : null;
            const parsedPort = Number(dbStatus.serverPort || dbStatus.port || 3000);

            setStatus({
              isConnected: !!(
                dbStatus.connected
                || dbStatus.expressBackend
                || dbStatus.expressPort
              ),
              isServer: mode === 'server' || mode === 'standalone',
              databasePath: parsedPath,
              serverIp: parsedServerAddress,
              serverPort: Number.isFinite(parsedPort) ? parsedPort : 3000,
              mode,
              lastChecked: new Date(),
            });
            return;
          }
        } catch (e) {
          console.error('[DatabaseStatus] Electron db.getStatus failed, falling back to HTTP health:', e);
        }
      }
      
      // First check Electron persistent storage for setup config
      let setupComplete = false;
      let isServerMode = false;
      let serverConfig: any = null;
      let clientConfig: any = null;
      
      if (isElectron && window.electronAPI?.setup?.getConfig) {
        try {
          const result = await window.electronAPI.setup.getConfig();
          if (result.success && result.config) {
            setupComplete = result.config.setupComplete;
            isServerMode = result.config.role === 'server';
            serverConfig = result.config.serverConfig;
            clientConfig = result.config.clientConfig;
          }
        } catch (e) {
          console.error('[DatabaseStatus] Failed to get Electron config:', e);
        }
      }
      
      // Fallback to localStorage
      if (!setupComplete) {
        setupComplete = localStorage.getItem('kwanza_setup_complete') === 'true';
        isServerMode = localStorage.getItem('kwanza_is_server') === 'true';
        
        const storedServerConfig = localStorage.getItem('kwanza_server_config');
        const storedClientConfig = localStorage.getItem('kwanza_client_config');
        
        if (storedServerConfig) {
          try { serverConfig = JSON.parse(storedServerConfig); } catch {}
        }
        if (storedClientConfig) {
          try { clientConfig = JSON.parse(storedClientConfig); } catch {}
        }
      }
      
      if (!setupComplete) {
        setStatus({
          isConnected: false,
          isServer: false,
          databasePath: null,
          serverIp: null,
          serverPort: 3000,
          mode: 'unknown',
          lastChecked: new Date(),
        });
        return;
      }

      const rawApiUrl = getApiUrl();
      const parsedApiUrl = (() => {
        try {
          return new URL(rawApiUrl);
        } catch {
          return new URL(`http://${rawApiUrl.replace(/^https?:\/\//, '')}`);
        }
      })();

      const serverIp = (isServerMode ? serverConfig?.serverIp : clientConfig?.serverIp) || parsedApiUrl.hostname || null;
      const serverPort = Number((isServerMode ? serverConfig?.serverPort : clientConfig?.serverPort) || parsedApiUrl.port || 3000);
      const databasePath = serverConfig?.databasePath || serverConfig?.connectionString || null;

      let connected = false;
      try {
        const response = await fetch(`${parsedApiUrl.origin}/api/health`, {
          signal: AbortSignal.timeout(3000),
        });
        connected = response.ok;
      } catch {
        connected = false;
      }

      setStatus({
        isConnected: connected,
        isServer: isServerMode,
        databasePath,
        serverIp,
        serverPort,
        mode: isServerMode ? 'server' : 'client',
        lastChecked: new Date(),
      });
    } catch (error) {
      console.error('Failed to check database status:', error);
      setStatus(prev => ({
        ...prev,
        isConnected: false,
        lastChecked: new Date(),
      }));
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check status on mount and periodically
  useEffect(() => {
    // Skip polling in web preview mode (no backend available)
    if (isWebPreview()) return;
    
    checkStatus();
    
    const interval = setInterval(checkStatus, 30000);
    
    return () => clearInterval(interval);
  }, [checkStatus]);

  return { status, isChecking, checkStatus };
}
