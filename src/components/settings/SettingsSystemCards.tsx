import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Settings as SettingsIcon,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Monitor,
  Info,
  Loader2,
  Server,
  MonitorSmartphone,
  RotateCcw,
} from 'lucide-react';
import { CompanySettingsDialog } from '@/components/settings/CompanySettingsDialog';
import { toast } from 'sonner';
import type { UpdateStatus, SetupConfig } from '@/types/electron';

type AppInfoCardProps = {
  appVersion: string;
  isElectron: boolean;
};

export function AppInfoCard({ appVersion, isElectron }: AppInfoCardProps) {
  const { t } = useTranslation();
  const ui = t.settingsPage.appInfo;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="w-5 h-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.application}</span>
          <span className="font-medium">NEXOR ERP</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.developer}</span>
          <span className="font-medium">Hassan Merhi</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.version}</span>
          <Badge variant="outline">{appVersion || ui.webVersion}</Badge>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.platform}</span>
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4" />
            <span className="font-medium capitalize">
              {isElectron ? window.electronAPI?.platform : 'Web Browser'}
            </span>
          </div>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.environment}</span>
          <Badge variant={isElectron ? 'default' : 'secondary'}>
            {isElectron ? ui.desktopApp : ui.webApp}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

type SoftwareUpdatesCardProps = {
  isElectron: boolean;
  updateStatus: UpdateStatus | null;
  isChecking: boolean;
  isDownloading: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onOpenReleasePage: () => void;
};

export function SoftwareUpdatesCard({
  isElectron,
  updateStatus,
  isChecking,
  isDownloading,
  onCheck,
  onDownload,
  onInstall,
  onOpenReleasePage,
}: SoftwareUpdatesCardProps) {
  const { t } = useTranslation();
  const ui = t.settingsPage.updates;

  const getStatusBadge = () => {
    if (!updateStatus) return null;
    switch (updateStatus.status) {
      case 'checking':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {ui.checking}
          </Badge>
        );
      case 'available':
        return (
          <Badge variant="default" className="gap-1 bg-primary">
            <Download className="w-3 h-3" />
            {ui.updateAvailable.replace('{version}', updateStatus.version || '')}
          </Badge>
        );
      case 'not-available':
        return (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
            <CheckCircle2 className="w-3 h-3" /> {ui.upToDate}
          </Badge>
        );
      case 'downloading':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {ui.downloading}
          </Badge>
        );
      case 'downloaded':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle2 className="w-3 h-3" /> {ui.readyToInstall}
          </Badge>
        );
      case 'installing':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {ui.installing}
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="w-3 h-3" /> {ui.error}
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isElectron ? (
          <div className="p-4 rounded-lg bg-muted/50 text-center">
            <p className="text-sm text-muted-foreground">{ui.desktopOnly}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{ui.status}</span>
              {getStatusBadge() || <Badge variant="outline">{ui.notChecked}</Badge>}
            </div>

            {updateStatus?.status === 'downloading' && updateStatus.progress !== undefined && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{ui.downloadingProgress}</span>
                  <span>{Math.round(updateStatus.progress)}%</span>
                </div>
                <Progress value={updateStatus.progress} className="h-2" />
              </div>
            )}

            {updateStatus?.status === 'error' && updateStatus.error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {updateStatus.error}
              </div>
            )}

            <Separator />

            <div className="flex flex-col gap-2">
              {updateStatus?.status === 'downloaded' ? (
                <Button onClick={onInstall} className="w-full gap-2">
                  <Download className="w-4 h-4" />
                  {ui.installAndRestart}
                </Button>
              ) : updateStatus?.status === 'available' ? (
                <>
                  <Button onClick={onDownload} disabled={isDownloading} className="w-full gap-2">
                    {isDownloading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {ui.downloadUpdate}
                  </Button>
                  <Button onClick={onOpenReleasePage} variant="outline" className="w-full gap-2">
                    <Download className="w-4 h-4" />
                    {ui.downloadFromGitHub}
                  </Button>
                </>
              ) : updateStatus?.status === 'error' ? (
                <>
                  <Button onClick={onCheck} disabled={isChecking} variant="outline" className="w-full gap-2">
                    {isChecking ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    {ui.checkForUpdates}
                  </Button>
                  <Button onClick={onOpenReleasePage} variant="outline" className="w-full gap-2">
                    <Download className="w-4 h-4" />
                    {ui.downloadFromGitHub}
                  </Button>
                </>
              ) : (
                <Button onClick={onCheck} disabled={isChecking} variant="outline" className="w-full gap-2">
                  {isChecking ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {ui.checkForUpdates}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CompanySettingsLauncherCard() {
  const { t } = useTranslation();
  const ui = t.settingsPage.company;
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <SettingsIcon className="w-4 h-4 mr-2" />
          {ui.openButton}
        </Button>
        <CompanySettingsDialog open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  );
}

type SetupConfigCardProps = {
  setupConfig: SetupConfig | null;
  isElectron: boolean;
};

export function SetupConfigCard({ setupConfig, isElectron }: SetupConfigCardProps) {
  const { t } = useTranslation();
  const ui = t.settingsPage.setup;
  const navigate = useNavigate();
  const [isResetting, setIsResetting] = useState(false);
  const [isStandaloneSwitching, setIsStandaloneSwitching] = useState(false);

  const handleStandaloneTestSwitch = async () => {
    if (!isElectron || !window.electronAPI?.setup?.configureStandalone) return;
    setIsStandaloneSwitching(true);
    try {
      const result = await window.electronAPI.setup.configureStandalone();
      if (!result.success) {
        throw new Error(result.error || ui.standaloneFailed);
      }
      localStorage.setItem('kwanza_setup_complete', 'true');
      localStorage.setItem('kwanza_is_server', 'true');
      localStorage.removeItem('kwanza_client_config');
      localStorage.removeItem('kwanza_mode');
      localStorage.removeItem('nexor_offline_first');
      const { invalidateElectronApiBaseCache } = await import('@/lib/api/config');
      invalidateElectronApiBaseCache();
      toast.success(ui.standaloneSuccess, {
        description: ui.standaloneSuccessDesc.replace(
          '{path}',
          result.databasePath || 'erp.db',
        ),
      });
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      const message = error instanceof Error ? error.message : ui.standaloneFailed;
      toast.error(message);
    } finally {
      setIsStandaloneSwitching(false);
    }
  };

  const handleResetSetup = async () => {
    setIsResetting(true);
    try {
      if (isElectron && window.electronAPI?.setup?.reset) {
        await window.electronAPI.setup.reset();
      }
      localStorage.removeItem('kwanza_setup_complete');
      localStorage.removeItem('kwanza_is_server');
      localStorage.removeItem('kwanza_server_config');
      localStorage.removeItem('kwanza_client_config');
      localStorage.removeItem('kwanza_api_url');
      toast.success(ui.resetSuccess);
      setTimeout(() => {
        navigate('/setup');
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Failed to reset setup:', error);
      toast.error(ui.resetFailed);
    } finally {
      setIsResetting(false);
    }
  };

  const modeLabel =
    setupConfig?.role === 'server'
      ? ui.server
      : setupConfig?.role === 'client'
        ? ui.client
        : ui.notConfigured;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {setupConfig?.role === 'server' ? (
            <Server className="w-5 h-5" />
          ) : (
            <MonitorSmartphone className="w-5 h-5" />
          )}
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.mode}</span>
          <Badge variant={setupConfig?.role === 'server' ? 'default' : 'secondary'}>
            {modeLabel}
          </Badge>
        </div>

        {setupConfig?.role === 'server' && setupConfig.serverConfig && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{ui.database}</span>
              <span className="text-xs font-mono truncate max-w-[250px]">
                {setupConfig.serverConfig.databasePath || '.nexor/.db (not set)'}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{ui.serverIp}</span>
              <span className="font-medium">
                {setupConfig.serverConfig.serverIp || ui.autoDetect}
              </span>
            </div>
          </>
        )}

        {setupConfig?.role === 'client' && setupConfig.clientConfig && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{ui.serverAddress}</span>
              <span className="font-medium">
                {setupConfig.clientConfig.serverIp}:{setupConfig.clientConfig.serverPort || 3000}
              </span>
            </div>
          </>
        )}

        <Separator />
        {isElectron && window.electronAPI?.setup?.configureStandalone && (
          <Button
            variant="outline"
            onClick={handleStandaloneTestSwitch}
            disabled={isStandaloneSwitching}
            className="w-full gap-2"
          >
            {isStandaloneSwitching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
            {ui.standaloneButton}
          </Button>
        )}
        <Button
          variant="destructive"
          onClick={handleResetSetup}
          disabled={isResetting}
          className="w-full gap-2"
        >
          {isResetting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCcw className="w-4 h-4" />
          )}
          {ui.resetButton}
        </Button>
        <p className="text-xs text-muted-foreground text-center">{ui.resetHint}</p>
      </CardContent>
    </Card>
  );
}
