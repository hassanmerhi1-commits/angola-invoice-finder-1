import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Server, Monitor, Wifi, CheckCircle, XCircle, Loader2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { parseLanServerEndpoint } from '@/lib/lanServerAddress';

type SetupMode = 'select' | 'server-setup' | 'client-setup' | 'complete';

const ANGOLA_LOCATION_MAP: Record<string, string[]> = {
  Bengo: ['Ambriz', 'Bula Atumba', 'Dande', 'Dembos', 'Nambuangongo', 'Pango Aluquem'],
  Benguela: ['Balombo', 'Baia Farta', 'Benguela', 'Bocoio', 'Caimbambo', 'Catumbela', 'Chongoroi', 'Cubal', 'Ganda', 'Lobito'],
  Bié: ['Andulo', 'Camacupa', 'Catabola', 'Chinguar', 'Chitembo', 'Cuemba', 'Cunhinga', 'Kuito', 'Nharêa'],
  Cabinda: ['Belize', 'Buco-Zau', 'Cabinda', 'Cacongo'],
  CuandoCubango: ['Calai', 'Cuangar', 'Cuchi', 'Cuito Cuanavale', 'Dirico', 'Mavinga', 'Menongue', 'Nancova', 'Rivungo'],
  CuanzaNorte: ['Ambaca', 'Banga', 'Bolongongo', 'Cambambe', 'Cazengo', 'Golungo Alto', 'Gonguembo', 'Lucala', 'Ngonguembo', 'Quiculungo', 'Samba Caju'],
  CuanzaSul: ['Amboim', 'Cassongue', 'Conda', 'Ebo', 'Libolo', 'Mussende', 'Porto Amboim', 'Quibala', 'Quilenda', 'Seles', 'Sumbe', 'Waku Kungo'],
  Cunene: ['Cahama', 'Cuanhama', 'Curoca', 'Cuvelai', 'Namacunde', 'Ombadja', 'Ondjiva'],
  Huambo: ['Bailundo', 'Caála', 'Catchiungo', 'Chicala Cholohanga', 'Chinjenje', 'Ecunha', 'Huambo', 'Londuimbali', 'Longonjo', 'Mungo', 'Tchicala-Tcholoanga', 'Ucuma'],
  Huíla: ['Caconda', 'Cacula', 'Caluquembe', 'Chiange', 'Chibia', 'Chipindo', 'Cuvango', 'Gambos', 'Humpata', 'Jamba', 'Lubango', 'Matala', 'Quilengues', 'Quipungo'],
  Luanda: ['Belas', 'Cacuaco', 'Cazenga', 'Icolo e Bengo', 'Kilamba Kiaxi', 'Luanda', 'Quiçama', 'Talatona', 'Viana'],
  LundaNorte: ['Cambulo', 'Capenda Camulemba', 'Caungula', 'Chitato', 'Cuango', 'Cuilo', 'Lubalo', 'Lucapa', 'Xá-Muteba'],
  LundaSul: ['Cacolo', 'Dala', 'Muconda', 'Saurimo'],
  Malanje: ['Cacuso', 'Calandula', 'Cambundi-Catembo', 'Cangandala', 'Caombo', 'Cuaba Nzoji', 'Cunda-Dia-Baze', 'Luquembo', 'Malanje', 'Marimba', 'Massango', 'Mucari', 'Quela', 'Quirima'],
  Moxico: ['Alto Zambeze', 'Bundas', 'Camanongue', 'Léua', 'Luacano', 'Luau', 'Luchazes', 'Moxico'],
  Namibe: ['Bibala', 'Camucuio', 'Moçâmedes', 'Tômbwa', 'Virei'],
  Uíge: ['Alto Cauale', 'Ambuíla', 'Bembe', 'Buengas', 'Bungo', 'Damba', 'Milunga', 'Mucaba', 'Negage', 'Puri', 'Quimbele', 'Quitexe', 'Sanza Pombo', 'Songo', 'Uíge', 'Zombo'],
  Zaire: ['Mbanza Kongo', 'Nóqui', 'Nzeto', 'Soyo', 'Tomboco'],
};

function slugMunicipioName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeServerAddressInput(raw: string): string {
  const parsed = parseLanServerEndpoint(raw);
  if (!parsed.host) return '';
  if (parsed.port) return `${parsed.host}:${parsed.port}`;
  return parsed.host;
}

function splitServerHostAndPort(raw: string): { host: string; httpPort: number } {
  const parsed = parseLanServerEndpoint(raw);
  return {
    host: parsed.host,
    httpPort: parsed.port ?? 3000,
  };
}

function isDatabasePathValue(raw: string): boolean {
  return /^[A-Za-z]:\\.+\.(db|nexor)$/i.test(raw.trim());
}

export default function Setup() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mode, setMode] = useState<SetupMode>('select');
  const [ipFileContent, setIpFileContent] = useState('');
  const [detectedIp, setDetectedIp] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedMunicipio, setSelectedMunicipio] = useState('');
  const [mainApiUrl, setMainApiUrl] = useState('');
  const [serverRole, setServerRole] = useState<'city' | 'hq'>('city');
  const [discoveredServers, setDiscoveredServers] = useState<Array<{ address: string; port: number; name: string }>>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const isElectron = !!window.electronAPI?.isElectron;

  // Read current IP file on mount
  useEffect(() => {
    if (isElectron && window.electronAPI?.ipfile) {
      window.electronAPI.ipfile.read().then(content => {
        if (content?.trim()) {
          setIpFileContent(content.trim());
        }
      });
    }
  }, [isElectron]);

  // Detect local IP when in server mode
  useEffect(() => {
    if (mode === 'server-setup' && isElectron) {
      window.electronAPI?.network.getLocalIPs().then(ips => {
        if (ips?.length > 0) setDetectedIp(ips[0]);
      });
    }
  }, [mode, isElectron]);

  useEffect(() => {
    if (mode !== 'server-setup') return;
    if (serverRole === 'hq') {
      setIpFileContent('C:\\NEXOR ERP\\data\\nexor-heart.nexor');
      return;
    }
    if (!selectedMunicipio) return;
    const fileName = `${slugMunicipioName(selectedMunicipio)}.db`;
    setIpFileContent(`C:\\NEXOR ERP\\data\\${fileName}`);
  }, [mode, selectedMunicipio, serverRole]);

  const handleServerSetup = async () => {
    setIsLoading(true);
    const dbPath = ipFileContent || 'C:\\NEXOR ERP\\data\\nexor-heart.nexor';

    if (serverRole === 'city' && (!selectedProvince || !selectedMunicipio)) {
      toast.error(t.setupUi.selectProvinceAndMunicipio);
      setIsLoading(false);
      return;
    }

    try {
      if (isElectron) {
        // Write DB path to IP file → server mode
        await window.electronAPI!.ipfile.write(dbPath);
        // Re-init database (creates if not exists + starts WS server)
        const result = await window.electronAPI!.db.init();
        if (!result.success) throw new Error(result.error);

        localStorage.setItem('kwanza_is_server', 'true');
        localStorage.removeItem('kwanza_client_config');

        try {
          const { invalidateElectronApiBaseCache, getApiUrl } = await import('@/lib/api/config');
          invalidateElectronApiBaseCache();
          const apiBase = await getApiUrl();

          if (serverRole === 'hq') {
            localStorage.setItem('nexor_installation_role', 'main_server');
            localStorage.removeItem('nexor_city_location');
            const regRes = await fetch(`${apiBase}/api/installations/register-main`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            if (regRes.ok) {
              const body = await regRes.json().catch(() => ({}));
              if (body.apiKey) {
                localStorage.setItem('nexor_sync_api_key', body.apiKey);
              }
            }
            toast.success(t.setupUi.hqConfigured, {
              description: `${t.setupUi.dbPathLabel}: ${dbPath}\n${t.setupUi.hqApiKeySaved}`,
            });
          } else {
            localStorage.setItem('nexor_installation_role', 'city_server');
            localStorage.setItem(
              'nexor_city_location',
              JSON.stringify({ province: selectedProvince, municipio: selectedMunicipio }),
            );
            if (mainApiUrl.trim()) {
              localStorage.setItem('nexor_main_api_url', mainApiUrl.trim());
            }
            const savedMain = localStorage.getItem('nexor_main_api_url') || '';
            await fetch(`${apiBase}/api/installations/register-city`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                province: selectedProvince,
                municipio: selectedMunicipio,
                mainApiUrl: savedMain || null,
              }),
            }).catch(() => null);
            toast.success(t.setupUi.serverConfigured, {
              description: `${t.setupUi.dbPathLabel}: ${dbPath}\n${t.setupUi.otherComputersConnect.replace('{ip}', detectedIp)}`,
            });
          }
        } catch { /* ignore registration errors */ }

        await window.electronAPI!.setup?.saveConfig?.({
          setupComplete: true,
          role: 'server',
          serverConfig: {
            databasePath: dbPath,
            serverIp: detectedIp || '',
            httpPort: 3000,
          },
        });
      } else {
        // Web preview - use localStorage fallback
        localStorage.setItem('kwanza_mode', 'server');
        localStorage.setItem('kwanza_db_path', dbPath);
        toast.success(t.setupUi.serverPreviewConfigured);
      }

      localStorage.setItem('kwanza_setup_complete', 'true');
      setMode('complete');
    } catch (error: any) {
      toast.error(t.setupUi.configError, { description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClientSetup = async () => {
    const normalized = normalizeServerAddressInput(ipFileContent);
    if (!normalized) {
      toast.error(t.setupUi.enterServerAddress);
      return;
    }
    if (isDatabasePathValue(normalized)) {
      toast.error('Este PC é cliente — use o IP do servidor, não o caminho .db', {
        description: 'Exemplo: 192.168.10.200 (copie do ecrã do servidor)',
      });
      return;
    }
    if (connectionStatus !== 'success') {
      toast.error('Teste a ligação antes de continuar', {
        description: 'Clique em "Testar Conexão" e confirme que aparece OK',
      });
      return;
    }

    setIsLoading(true);
    try {
      if (isElectron) {
        const { host: serverIp, httpPort } = splitServerHostAndPort(normalized);
        await window.electronAPI!.ipfile.write(serverIp);
        const result = await window.electronAPI!.db.init();
        if (!result.success) throw new Error(result.error);

        localStorage.setItem('kwanza_is_server', 'false');
        localStorage.setItem('nexor_installation_role', 'shop_client');
        localStorage.setItem('nexor_offline_first', 'true');
        localStorage.setItem(
          'kwanza_client_config',
          JSON.stringify({
            serverIp,
            httpPort,
            useSocketIo: true,
          }),
        );
        try {
          const { invalidateElectronApiBaseCache } = await import('@/lib/api/config');
          invalidateElectronApiBaseCache();
        } catch { /* ignore */ }

        toast.success(t.setupUi.clientConfigured, {
          description: t.setupUi.connectedToServer.replace('{server}', ipFileContent.trim())
        });

        await window.electronAPI!.setup?.saveConfig?.({
          setupComplete: true,
          role: 'client',
          clientConfig: {
            serverIp,
            httpPort,
          },
        });
      } else {
        localStorage.setItem('kwanza_mode', 'client');
        localStorage.setItem('kwanza_server_address', ipFileContent.trim());
        toast.success(t.setupUi.clientPreviewConfigured);
      }

      localStorage.setItem('kwanza_setup_complete', 'true');
      setMode('complete');
    } catch (error: any) {
      toast.error(t.setupUi.connectionError, { description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const testConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    const normalized = normalizeServerAddressInput(ipFileContent);
    if (!normalized) {
      setConnectionStatus('error');
      setConnectionError(t.setupUi.enterServerAddress);
      return;
    }
    if (isDatabasePathValue(normalized)) {
      setConnectionStatus('error');
      setConnectionError('Caminho .db é para o servidor — neste PC use só o IP (ex: 192.168.10.200)');
      toast.error('IP incorrecto para cliente');
      return;
    }
    try {
      if (isElectron) {
        const { host } = splitServerHostAndPort(normalized);
        await window.electronAPI!.ipfile.write(host);
        const result = await window.electronAPI!.db.testConnection();
        setConnectionStatus(result.success ? 'success' : 'error');
        if (result.success) {
          toast.success(t.setupUi.connectionOk);
        } else {
          const err = result.error || t.setupUi.connectionFailed;
          setConnectionError(err);
          toast.error(t.setupUi.connectionFailed, { description: err });
        }
      } else {
        // Web preview - simulate
        await new Promise(r => setTimeout(r, 1000));
        setConnectionStatus('error');
        toast.error(t.setupUi.serverNotFoundElectronOnly);
      }
    } catch {
      setConnectionStatus('error');
      toast.error(t.setupUi.connectionFailed);
    }
  };

  const discoverServers = async () => {
    if (!isElectron || !window.electronAPI?.discovery?.scan) {
      toast.error('Descoberta automática só disponível na app desktop');
      return;
    }
    setIsDiscovering(true);
    setDiscoveredServers([]);
    setConnectionStatus('idle');
    setConnectionError('');
    try {
      const result = await window.electronAPI.discovery.scan(6000);
      if (result.success && result.servers?.length) {
        setDiscoveredServers(result.servers);
        const first = result.servers[0];
        setIpFileContent(first.address);
        toast.success(`Servidor encontrado: ${first.name} (${first.address})`);
      } else {
        toast.error('Nenhum servidor na rede Wi-Fi', {
          description: 'No servidor: abra NEXOR ERP, anote o IP Wi-Fi e use-o aqui. Se falhar, execute scripts\\allow-nexor-lan.ps1 como Administrador no servidor.',
        });
      }
    } catch (error: any) {
      toast.error('Descoberta falhou', { description: error.message });
    } finally {
      setIsDiscovering(false);
    }
  };

  const startDemoMode = () => {
    localStorage.setItem('kwanza_setup_complete', 'true');
    localStorage.setItem('kwanza_mode', 'demo');
    toast.success(t.setupUi.demoModeActivated, {
      description: t.setupUi.demoModeDesc
    });
    setMode('complete');
  };

  const finishSetup = () => navigate('/login');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50/50 to-indigo-50/30 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <span className="text-primary-foreground font-bold text-4xl">N</span>
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-2">NEXOR ERP</h1>
          <p className="text-muted-foreground text-lg">{t.auth.tagline}</p>
          <p className="text-muted-foreground text-sm mt-1">{t.setupUi.initialSetup}</p>
        </div>

        {/* Mode Selection */}
        {mode === 'select' && (
          <Card className="shadow-2xl">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-2xl">{t.setupUi.howUsed}</CardTitle>
              <CardDescription>
                {t.setupUi.chooseServerOrClient}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 px-6 pb-8">
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  className="group border-2 border-border rounded-xl p-6 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
                  onClick={() => {
                    setMode('server-setup');
                    setSelectedProvince('');
                    setSelectedMunicipio('');
                    setIpFileContent('');
                  }}
                >
                  <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Server className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-lg text-foreground">Servidor</div>
                    <div className="text-sm text-muted-foreground">
                      Computador principal com a base de dados. Outros computadores conectam aqui.
                    </div>
                  </div>
                  <Badge variant="secondary">Escritório principal</Badge>
                </button>

                <button
                  className="group border-2 border-border rounded-xl p-6 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
                  onClick={() => { setMode('client-setup'); setIpFileContent(''); }}
                >
                  <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Monitor className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-lg text-foreground">Cliente</div>
                    <div className="text-sm text-muted-foreground">
                      Estação de trabalho que conecta ao servidor. Dados ficam no servidor.
                    </div>
                  </div>
                  <Badge variant="outline">Computadores adicionais</Badge>
                </button>
              </div>

              {/* Demo Mode */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">ou</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full h-auto py-4"
                onClick={startDemoMode}
              >
                <div className="flex items-center gap-3">
                  <Monitor className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <div className="font-semibold">Modo Demo</div>
                    <div className="text-xs text-muted-foreground">Usar armazenamento local sem rede</div>
                  </div>
                </div>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Server Setup */}
        {mode === 'server-setup' && (
          <Card className="shadow-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setMode('select')}>← Voltar</Button>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-primary" /> Configurar Servidor
                  </CardTitle>
                  <CardDescription>
                    Configurar ficheiro local .nexor para a base de dados
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  className={`border-2 rounded-lg p-4 text-left transition-colors ${
                    serverRole === 'city' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => setServerRole('city')}
                >
                  <div className="font-semibold">{t.setupUi.serverRoleCity}</div>
                  <p className="text-xs text-muted-foreground mt-1">{t.setupUi.serverRoleCityDesc}</p>
                </button>
                <button
                  type="button"
                  className={`border-2 rounded-lg p-4 text-left transition-colors ${
                    serverRole === 'hq' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => setServerRole('hq')}
                >
                  <div className="font-semibold">{t.setupUi.serverRoleHq}</div>
                  <p className="text-xs text-muted-foreground mt-1">{t.setupUi.serverRoleHqDesc}</p>
                </button>
              </div>

              {serverRole === 'city' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Província</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedProvince}
                    onChange={(e) => {
                      setSelectedProvince(e.target.value);
                      setSelectedMunicipio('');
                    }}
                  >
                    <option value="">Selecione a província</option>
                    {Object.keys(ANGOLA_LOCATION_MAP).map((province) => (
                      <option key={province} value={province}>{province}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Município</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedMunicipio}
                    onChange={(e) => setSelectedMunicipio(e.target.value)}
                    disabled={!selectedProvince}
                  >
                    <option value="">Selecione o município</option>
                    {(ANGOLA_LOCATION_MAP[selectedProvince] || []).map((municipio) => (
                      <option key={municipio} value={municipio}>{municipio}</option>
                    ))}
                  </select>
                </div>
              </div>
              )}

              {serverRole === 'city' && (
              <div className="space-y-2">
                <Label>URL do servidor sede (opcional)</Label>
                <Input
                  value={mainApiUrl}
                  onChange={(e) => setMainApiUrl(e.target.value)}
                  placeholder="http://192.168.1.10:3000"
                />
                <p className="text-xs text-muted-foreground">
                  Sede nacional para replicação de vendas em tempo quase real
                </p>
              </div>
              )}

              <div className="space-y-2">
                <Label>Caminho do ficheiro .nexor</Label>
                <div className="flex gap-2">
                  <Input
                    value={ipFileContent}
                    onChange={e => setIpFileContent(e.target.value)}
                    placeholder="C:\\NEXOR ERP\\data\\nexor-heart.nexor"
                  />
                  <Button variant="outline" size="icon">
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  O nome do ficheiro e gerado pelo município escolhido (ex: soyo.nexor)
                </p>
              </div>

              {detectedIp && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Wifi className="h-4 w-4 text-primary" />
                    <span className="text-muted-foreground">IP deste computador:</span>
                    <span className="font-mono font-bold text-foreground">{detectedIp}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clientes devem usar este IP (ou nome do computador) no ficheiro IP
                  </p>
                </div>
              )}

              <Button
                onClick={handleServerSetup}
                className="w-full"
                disabled={isLoading || (serverRole === 'city' && (!selectedProvince || !selectedMunicipio))}
              >
                {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Configurando...</>
                  : <><CheckCircle className="h-4 w-4 mr-2" /> Iniciar Servidor</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Client Setup */}
        {mode === 'client-setup' && (
          <Card className="shadow-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setMode('select')}>← Voltar</Button>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-primary" /> Configurar Cliente
                  </CardTitle>
                  <CardDescription>
                    Insira o IP ou nome do computador servidor
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Endereço do Servidor</Label>
                <Input
                  value={ipFileContent}
                  onChange={e => {
                    setIpFileContent(e.target.value);
                    setConnectionStatus('idle');
                    setConnectionError('');
                  }}
                  placeholder="192.168.10.200"
                />
                <p className="text-xs text-muted-foreground">
                  IP Wi‑Fi do computador servidor (não use caminho .db nem localhost)
                </p>
              </div>

              <Button
                variant="secondary"
                className="w-full"
                onClick={discoverServers}
                disabled={isDiscovering}
              >
                {isDiscovering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
                Procurar servidor na rede
              </Button>

              {discoveredServers.length > 0 && (
                <div className="space-y-2">
                  {discoveredServers.map((server) => (
                    <button
                      key={`${server.address}:${server.port}`}
                      type="button"
                      className="w-full text-left border rounded-lg p-3 hover:border-primary hover:bg-primary/5"
                      onClick={() => {
                        setIpFileContent(server.address);
                        setConnectionStatus('idle');
                        setConnectionError('');
                      }}
                    >
                      <div className="font-medium">{server.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{server.address}:{server.port}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={testConnection} disabled={!ipFileContent.trim() || connectionStatus === 'testing'}>
                  {connectionStatus === 'testing' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
                  Testar Conexão
                </Button>
                {connectionStatus === 'success' && <Badge className="bg-primary/10 text-primary border-primary/20"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>}
                {connectionStatus === 'error' && <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Falhou</Badge>}
              </div>

              {connectionError && (
                <p className="text-sm text-destructive">{connectionError}</p>
              )}

              <Button onClick={handleClientSetup} className="w-full" disabled={isLoading || !ipFileContent.trim()}>
                {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Conectando...</>
                  : <><CheckCircle className="h-4 w-4 mr-2" /> Conectar ao Servidor</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Complete */}
        {mode === 'complete' && (
          <Card className="shadow-2xl">
            <CardContent className="py-12 text-center space-y-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">Configuração Completa!</h2>
                <p className="text-muted-foreground mt-2">
                  O sistema está pronto para usar. Faça login para começar.
                </p>
              </div>
              <Button size="lg" onClick={finishSetup}>
                Ir para Login
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Info footer */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          <p>Base de dados: ficheiro local .nexor</p>
          <p className="mt-1">Servidor = caminho .nexor | Cliente = IP do servidor</p>
        </div>
      </div>
    </div>
  );
}