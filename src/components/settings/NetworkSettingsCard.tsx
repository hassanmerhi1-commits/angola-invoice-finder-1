import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { 
  Network, 
  Wifi, 
  WifiOff, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Server,
  Globe,
  RefreshCw,
  Search,
  Radio,
  Users,
  Play,
  Square,
  FlaskConical,
  Activity
} from 'lucide-react';
import { getApiUrl, setApiUrl, isLocalNetworkMode, setForceApiMode } from '@/lib/api/config';
import { toast } from 'sonner';
import type { DiscoveredServer } from '@/types/electron';
import { useTranslation } from '@/i18n';

import { 
  startMockServer, 
  stopMockServer, 
  isMockServerRunning, 
  mockHealthCheck,
  getMockDiscoveredServers,
  configureMockServer,
  subscribeMockEvents,
  getMockServerStatus
} from '@/lib/mockServer';

interface ConnectionTestResult {
  success: boolean;
  latency?: number;
  serverInfo?: {
    status: string;
    timestamp: string;
    serverName?: string;
    connectedClients?: number;
  };
  error?: string;
}

// Keep the in-progress server address across section/tab navigation (the card
// unmounts when you leave Settings). Module scope so it survives remounts within
// the session but resets on a full page reload (i.e. after Save applies it).
let draftServerUrl: string | null = null;

export function NetworkSettingsCard() {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState('');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isNetworkMode, setIsNetworkMode] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Server discovery state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [isElectron, setIsElectron] = useState(false);
  
  // Mock server state
  const [mockServerRunning, setMockServerRunning] = useState(false);
  const [mockLatency, setMockLatency] = useState(50);
  const [mockFailureRate, setMockFailureRate] = useState(0);
  const [mockRequestCount, setMockRequestCount] = useState(0);

  useEffect(() => {
    const currentUrl = getApiUrl();
    // Restore a previously typed (but not yet saved) address so navigating away
    // and back doesn't silently revert the field to the loopback default.
    const initialUrl = draftServerUrl ?? currentUrl;
    setServerUrl(initialUrl);
    if (draftServerUrl != null && draftServerUrl !== currentUrl) {
      setHasChanges(true);
    }
    setIsNetworkMode(isLocalNetworkMode());
    setIsElectron(!!window.electronAPI?.discovery);
    setMockServerRunning(isMockServerRunning());
    
    // Subscribe to mock server events
    const unsubscribe = subscribeMockEvents((event, data) => {
      if (event === 'request') {
        setMockRequestCount(prev => prev + 1);
      }
    });
    
    return unsubscribe;
  }, []);

  const handleUrlChange = (value: string) => {
    draftServerUrl = value;
    setServerUrl(value);
    setHasChanges(true);
    setTestResult(null);
  };

  const testConnection = async () => {
    if (!serverUrl) {
      toast.error(t.networkSettingsUi.enterServerAddress);
      return;
    }

    setIsTestingConnection(true);
    setTestResult(null);

    const startTime = Date.now();

    try {
      // Normalize URL
      let url = serverUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'http://' + url;
      }
      
      // Remove trailing slash
      url = url.replace(/\/$/, '');

      const response = await fetch(`${url}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      const latency = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        setTestResult({
          success: true,
          latency,
          serverInfo: data,
        });
        toast.success(t.networkSettingsUi.connectionSuccessLatency.replace('{ms}', String(latency)));
      } else {
        setTestResult({
          success: false,
          error: `Servidor respondeu com erro: ${response.status}`,
        });
        toast.error(t.networkSettingsUi.connectionFailed);
      }
    } catch (error: any) {
      const latency = Date.now() - startTime;
      let errorMessage = t.networkSettingsUi.couldNotConnect;
      
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        errorMessage = t.networkSettingsUi.timeout5s;
      } else if (error.message?.includes('Failed to fetch')) {
        errorMessage = t.networkSettingsUi.serverNotFound;
      }

      setTestResult({
        success: false,
        latency,
        error: errorMessage,
      });
      toast.error(errorMessage);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const saveSettings = () => {
    if (!testResult?.success) {
      toast.error(t.networkSettingsUi.testBeforeSave);
      return;
    }

    // Normalize URL before saving
    let url = serverUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    url = url.replace(/\/$/, '');

    // The address is now the active config; drop the draft so the reloaded page
    // shows the saved value rather than the stale draft.
    draftServerUrl = null;
    setApiUrl(url);
    // Page will reload automatically
  };

  const toggleNetworkMode = (enabled: boolean) => {
    setForceApiMode(enabled);
    // Page will reload automatically
  };

  const resetToDefault = () => {
    draftServerUrl = 'http://localhost:3000';
    setServerUrl('http://localhost:3000');
    setHasChanges(true);
    setTestResult(null);
    toast.info(t.networkSettingsUi.resetToDefaultInfo);
  };

  // Discover servers on local network (Electron or Mock)
  const discoverServers = async () => {
    setIsDiscovering(true);
    setDiscoveredServers([]);
    toast.info(t.networkSettingsUi.scanningLocalNetwork);

    // Check for mock server first
    if (mockServerRunning) {
      await new Promise(r => setTimeout(r, 1000)); // Simulate scan time
      const mockServers = getMockDiscoveredServers();
      if (mockServers.length > 0) {
        setDiscoveredServers(mockServers);
        toast.success(t.networkSettingsUi.foundServersMock.replace('{count}', String(mockServers.length)));
        setIsDiscovering(false);
        return;
      }
    }

    // Use Electron discovery if available
    if (window.electronAPI?.discovery) {
      try {
        const result = await window.electronAPI.discovery.scan(5000);
        
        if (result.success && result.servers.length > 0) {
          setDiscoveredServers(result.servers);
          toast.success(t.networkSettingsUi.foundServers.replace('{count}', String(result.servers.length)));
        } else if (result.servers.length === 0) {
          toast.info(t.networkSettingsUi.noServersFound);
        } else {
          toast.error(result.error || t.networkSettingsUi.discoveryError);
        }
      } catch (error: any) {
        toast.error(t.networkSettingsUi.discoveryFailed.replace('{error}', error.message));
      }
    } else if (!mockServerRunning) {
      toast.info(t.networkSettingsUi.startLocalServerOrDesktop);
    }
    
    setIsDiscovering(false);
  };
  
  // Toggle mock server
  const toggleMockServer = () => {
    if (mockServerRunning) {
      stopMockServer();
      setMockServerRunning(false);
      setMockRequestCount(0);
      toast.info(t.networkSettingsUi.testServerStopped);
    } else {
      startMockServer({
        simulatedLatency: mockLatency,
        failureRate: mockFailureRate / 100
      });
      setMockServerRunning(true);
      toast.success(t.networkSettingsUi.testServerStarted);
    }
  };
  
  // Update mock server config
  const updateMockConfig = (latency: number, failureRate: number) => {
    setMockLatency(latency);
    setMockFailureRate(failureRate);
    if (mockServerRunning) {
      configureMockServer({
        simulatedLatency: latency,
        failureRate: failureRate / 100
      });
    }
  };
  
  // Test connection with mock server support
  const testConnectionWithMock = async () => {
    if (mockServerRunning && (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1'))) {
      setIsTestingConnection(true);
      setTestResult(null);
      
      const result = await mockHealthCheck();
      setTestResult(result);
      
      if (result.success) {
        toast.success(t.networkSettingsUi.mockConnectionSuccessLatency.replace('{ms}', String(result.latency)));
      } else {
        toast.error(result.error || t.networkSettingsUi.mockConnectionFailed);
      }
      
      setIsTestingConnection(false);
      return;
    }
    
    // Use regular test
    await testConnection();
  };

  // Select a discovered server
  const selectServer = (server: DiscoveredServer) => {
    const url = `http://${server.ip}:${server.port}`;
    draftServerUrl = url;
    setServerUrl(url);
    setHasChanges(true);
    setTestResult(null);
    toast.success(t.networkSettingsUi.serverSelected.replace('{name}', server.name));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="w-5 h-5" />
          {t.networkSettingsUi.title}
        </CardTitle>
        <CardDescription>
          Configure a conexão com o servidor central para sincronização em tempo real
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Mode */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            {isNetworkMode ? (
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Server className="w-5 h-5 text-emerald-600" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Globe className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="font-medium">
                {isNetworkMode ? 'Modo Rede' : 'Modo Local'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isNetworkMode 
                  ? 'Conectado ao servidor central' 
                  : 'Usando armazenamento local (demo)'
                }
              </p>
            </div>
          </div>
          <Badge variant={isNetworkMode ? 'default' : 'secondary'}>
            {isNetworkMode ? 'Ativo' : 'Offline'}
          </Badge>
        </div>

        <Separator />

        {/* Mock Server Section - Local Testing */}
        <div className="space-y-4 p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-primary" />
              <div>
                <p className="font-medium">Servidor de Teste Local</p>
                <p className="text-xs text-muted-foreground">
                  Simula conexão de rede no mesmo computador
                </p>
              </div>
            </div>
            <Button
              variant={mockServerRunning ? "destructive" : "default"}
              size="sm"
              onClick={toggleMockServer}
              className="gap-2"
            >
              {mockServerRunning ? (
                <>
                  <Square className="w-4 h-4" />
                  Parar
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Iniciar
                </>
              )}
            </Button>
          </div>
          
          {mockServerRunning && (
            <div className="space-y-4 pt-2">
              {/* Mock server stats */}
              <div className="flex items-center gap-4 text-sm">
                <Badge variant="outline" className="gap-1">
                  <Activity className="w-3 h-3" />
                  {mockRequestCount} requisições
                </Badge>
                <Badge variant="secondary">
                  Latência: {mockLatency}ms
                </Badge>
                <Badge variant={mockFailureRate > 0 ? "destructive" : "secondary"}>
                  Falhas: {mockFailureRate}%
                </Badge>
              </div>
              
              {/* Latency slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Latência simulada</span>
                  <span>{mockLatency}ms</span>
                </div>
                <Slider
                  value={[mockLatency]}
                  onValueChange={([val]) => updateMockConfig(val, mockFailureRate)}
                  min={0}
                  max={500}
                  step={10}
                />
              </div>
              
              {/* Failure rate slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Taxa de falha (para testes)</span>
                  <span>{mockFailureRate}%</span>
                </div>
                <Slider
                  value={[mockFailureRate]}
                  onValueChange={([val]) => updateMockConfig(mockLatency, val)}
                  min={0}
                  max={50}
                  step={5}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Auto-Discovery Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Radio className="w-4 h-4" />
              Descoberta Automática
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={discoverServers}
              disabled={isDiscovering}
              className="gap-2"
            >
              {isDiscovering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Procurando...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Procurar Servidores
                </>
              )}
            </Button>
          </div>
          
          {/* Discovered Servers List */}
          {discoveredServers.length > 0 && (
            <ScrollArea className="h-[160px] rounded-lg border">
              <div className="p-2 space-y-2">
                {discoveredServers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => selectServer(server)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Server className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{server.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {server.ip}:{server.port}
                          {server.hostname && ` (${server.hostname})`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs gap-1">
                        <Users className="w-3 h-3" />
                        {server.connectedClients}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        v{server.version}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
          
          {isDiscovering && (
            <div className="flex items-center justify-center p-6 rounded-lg border border-dashed">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t.networkSettingsUi.scanningNexorServers}
                </p>
              </div>
            </div>
          )}
        </div>
        
        <Separator />

        {/* Server URL Input */}
        <div className="space-y-3">
          <Label htmlFor="server-url">{t.networkSettingsUi.serverAddressLabel}</Label>
          <div className="flex gap-2">
            <Input
              id="server-url"
              placeholder="http://192.168.1.50:3000"
              value={serverUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={resetToDefault}
              title={t.networkSettingsUi.resetToDefaultTitle}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mockServerRunning 
              ? t.networkSettingsUi.testServerRunningHint
              : isElectron 
                ? t.networkSettingsUi.useDiscoveryOrManualIp
                : t.networkSettingsUi.enterServerIpHint
            }
          </p>
        </div>

        {/* Test Connection Button */}
        <Button
          variant="outline"
          onClick={testConnectionWithMock}
          disabled={isTestingConnection || !serverUrl}
          className="w-full gap-2"
        >
          {isTestingConnection ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.networkSettingsUi.testingConnection}
            </>
          ) : (
            <>
              <Wifi className="w-4 h-4" />
              {t.networkSettingsUi.testConnection} {mockServerRunning && '(Mock)'}
            </>
          )}
        </Button>

        {/* Test Result */}
        {testResult && (
          <div className={`p-4 rounded-lg border ${
            testResult.success 
              ? 'bg-emerald-500/10 border-emerald-500/30' 
              : 'bg-destructive/10 border-destructive/30'
          }`}>
            <div className="flex items-start gap-3">
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-destructive mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <p className={`font-medium ${
                  testResult.success ? 'text-emerald-600' : 'text-destructive'
                }`}>
                  {testResult.success ? t.networkSettingsUi.connectionSuccess : t.networkSettingsUi.connectionFailure}
                </p>
                {testResult.success ? (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>{t.networkSettingsUi.latency.replace('{ms}', String(testResult.latency))}</p>
                    {testResult.serverInfo?.serverName && (
                      <p>{t.networkSettingsUi.serverLabel.replace('{name}', testResult.serverInfo.serverName)}</p>
                    )}
                    {testResult.serverInfo?.connectedClients !== undefined && (
                      <p>{t.networkSettingsUi.connectedClients.replace('{count}', String(testResult.serverInfo.connectedClients))}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-destructive/80">
                    {testResult.error}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <Separator />

        {/* Save Button */}
        <Button
          onClick={saveSettings}
          disabled={!testResult?.success || !hasChanges}
          className="w-full gap-2"
        >
          {testResult?.success && hasChanges ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Salvar e Conectar
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4" />
              Teste a conexão primeiro
            </>
          )}
        </Button>

        {/* Force API Mode Toggle (for development) */}
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Forçar Modo API</p>
              <p className="text-xs text-muted-foreground">
                Usar API mesmo em localhost (para testes)
              </p>
            </div>
            <Switch
              checked={isNetworkMode}
              onCheckedChange={toggleNetworkMode}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
