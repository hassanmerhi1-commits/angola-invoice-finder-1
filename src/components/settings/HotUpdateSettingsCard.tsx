import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Zap, 
  Server, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff
} from 'lucide-react';
import { toast } from 'sonner';
import type { HotUpdateConfig } from '@/types/electron';
import { useTranslation } from '@/i18n';

export function HotUpdateSettingsCard() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<HotUpdateConfig>({
    enabled: false,
    serverUrl: '',
    autoConnect: false
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [webappVersion, setWebappVersion] = useState<string>('');
  const [loadSource, setLoadSource] = useState<'server' | 'local' | 'unknown'>('unknown');
  
  const isElectron = !!window.electronAPI?.hotUpdate;

  useEffect(() => {
    if (isElectron) {
      loadConfig();
      checkLoadSource();
    } else {
      setIsLoading(false);
    }
  }, [isElectron]);

  const loadConfig = async () => {
    try {
      const result = await window.electronAPI?.hotUpdate?.getConfig();
      if (result?.success && result.config) {
        setConfig(result.config);
        
        // Auto-check server status if URL is configured
        if (result.config.serverUrl) {
          checkServerStatus(result.config.serverUrl);
        }
      }
    } catch (error) {
      console.error('Failed to load hot update config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkLoadSource = async () => {
    try {
      const result = await window.electronAPI?.hotUpdate?.getSource();
      if (result?.success) {
        setLoadSource(result.source);
      }
    } catch (error) {
      console.error('Failed to get load source:', error);
    }
  };

  const checkServerStatus = async (url: string) => {
    if (!url) return;
    
    setIsChecking(true);
    setServerStatus('unknown');
    
    try {
      const result = await window.electronAPI?.hotUpdate?.checkServer(url);
      
      if (result?.success && result.available) {
        setServerStatus('online');
        setWebappVersion(result.version?.version || 'unknown');
        toast.success(t.hotUpdateUi.serverOnline);
      } else {
        setServerStatus('offline');
        setWebappVersion('');
        toast.error(t.hotUpdateUi.serverNotReachable);
      }
    } catch (error) {
      setServerStatus('offline');
      toast.error(t.hotUpdateUi.serverNotReachable);
    } finally {
      setIsChecking(false);
    }
  };

  const saveConfig = async (newConfig: Partial<HotUpdateConfig>) => {
    try {
      const updatedConfig = { ...config, ...newConfig };
      const result = await window.electronAPI?.hotUpdate?.setConfig(updatedConfig);
      
      if (result?.success && result.config) {
        setConfig(result.config);
        toast.success(t.hotUpdateUi.saved);
      } else {
        toast.error(result?.error || t.hotUpdateUi.saveFailed);
      }
    } catch (error) {
      toast.error(t.hotUpdateUi.saveFailed);
    }
  };

  const handleReload = async () => {
    try {
      const result = await window.electronAPI?.hotUpdate?.reload();
      
      if (result?.success) {
        toast.success(t.hotUpdateUi.reloadingFrom.replace('{source}', result.source));
      } else {
        toast.error(result?.error || t.hotUpdateUi.reloadFailed);
      }
    } catch (error) {
      toast.error(t.hotUpdateUi.reloadFailed);
    }
  };

  if (!isElectron) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            {t.hotUpdateUi.title}
          </CardTitle>
          <CardDescription>
            {t.hotUpdateUi.subtitle}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-muted/50 text-center">
            <p className="text-sm text-muted-foreground">
              Hot updates are only available in the desktop application.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            {t.hotUpdateUi.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          {t.hotUpdateUi.title}
        </CardTitle>
        <CardDescription>
          Load app from server - update by just replacing files
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Load Source */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Current Source</span>
          <Badge variant={loadSource === 'server' ? 'default' : 'secondary'}>
            {loadSource === 'server' ? (
              <><Wifi className="w-3 h-3 mr-1" /> Server</>
            ) : (
              <><WifiOff className="w-3 h-3 mr-1" /> Local</>
            )}
          </Badge>
        </div>

        <Separator />

        {/* Enable Hot Updates */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="hot-update-enabled">{t.hotUpdateUi.enable}</Label>
            <p className="text-sm text-muted-foreground">
              Load app from update server
            </p>
          </div>
          <Switch
            id="hot-update-enabled"
            checked={config.enabled}
            onCheckedChange={(enabled) => saveConfig({ enabled })}
          />
        </div>

        <Separator />

        {/* Server URL */}
        <div className="space-y-2">
          <Label htmlFor="server-url">Update Server URL</Label>
          <div className="flex gap-2">
            <Input
              id="server-url"
              placeholder="http://192.168.1.100:3000"
              value={config.serverUrl}
              onChange={(e) => setConfig({ ...config, serverUrl: e.target.value })}
              onBlur={() => saveConfig({ serverUrl: config.serverUrl })}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => checkServerStatus(config.serverUrl)}
              disabled={isChecking || !config.serverUrl}
            >
              {isChecking ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Server className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Server Status */}
        {config.serverUrl && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Server Status</span>
            {serverStatus === 'online' ? (
              <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                <CheckCircle2 className="w-3 h-3" /> Online
                {webappVersion && ` (v${webappVersion})`}
              </Badge>
            ) : serverStatus === 'offline' ? (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="w-3 h-3" /> Offline
              </Badge>
            ) : (
              <Badge variant="secondary">Unknown</Badge>
            )}
          </div>
        )}

        <Separator />

        {/* Reload Button */}
        <Button
          onClick={handleReload}
          variant="outline"
          className="w-full gap-2"
          disabled={!config.enabled || !config.serverUrl || serverStatus !== 'online'}
        >
          <RefreshCw className="w-4 h-4" />
          Apply Update Now
        </Button>

        {/* Instructions */}
        <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <p className="font-medium mb-1">How it works:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Build the webapp with <code className="bg-background px-1 rounded">npm run build</code></li>
            <li>Copy <code className="bg-background px-1 rounded">dist/*</code> to <code className="bg-background px-1 rounded">backend/webapp/</code></li>
            <li>All connected apps will load the new version</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
