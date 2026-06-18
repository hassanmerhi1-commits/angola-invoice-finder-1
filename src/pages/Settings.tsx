import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { InteractionSettingsCard } from '@/components/settings/InteractionSettingsCard';
import { SigningSettingsCard } from '@/components/settings/SigningSettingsCard';
import { AgtSettingsCard } from '@/components/settings/AgtSettingsCard';
import { AgtTransmissionsCard } from '@/components/settings/AgtTransmissionsCard';
import { SecuritySettingsCard } from '@/components/settings/SecuritySettingsCard';
import { CertificationReadinessCard } from '@/components/settings/CertificationReadinessCard';
import { DailyTodosSettingsCard } from '@/components/settings/DailyTodosSettingsCard';
import { NetworkSettingsCard } from '@/components/settings/NetworkSettingsCard';
import { HotUpdateSettingsCard } from '@/components/settings/HotUpdateSettingsCard';
import { BackendLogsCard } from '@/components/settings/BackendLogsCard';
import { DatabaseBackupCard } from '@/components/settings/DatabaseBackupCard';
import { ClientSyncSettingsCard } from '@/components/settings/ClientSyncSettingsCard';
import { SyncHealthSettingsCard } from '@/components/settings/SyncHealthSettingsCard';
import { DeploymentHealthCard } from '@/components/settings/DeploymentHealthCard';
import { DataConsistencyCard } from '@/components/settings/DataConsistencyCard';
import {
  SettingsSectionNav,
  SettingsSectionHeader,
} from '@/components/settings/SettingsSectionNav';
import {
  AppInfoCard,
  SoftwareUpdatesCard,
  CompanySettingsLauncherCard,
  SetupConfigCard,
} from '@/components/settings/SettingsSystemCards';
import {
  isSettingsSectionId,
  type SettingsSectionId,
} from '@/components/settings/settingsSections';
import { toast } from 'sonner';
import type { UpdateStatus, SetupConfig } from '@/types/electron';

const DEFAULT_SECTION: SettingsSectionId = 'general';

export default function Settings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const sectionParam = searchParams.get('section');
  const activeSection: SettingsSectionId = isSettingsSectionId(sectionParam)
    ? sectionParam
    : DEFAULT_SECTION;

  const setActiveSection = useCallback(
    (section: SettingsSectionId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (section === DEFAULT_SECTION) {
            next.delete('section');
          } else {
            next.set('section', section);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [setupConfig, setSetupConfig] = useState<SetupConfig | null>(null);

  const isElectron = !!window.electronAPI?.isElectron;

  useEffect(() => {
    const loadSetupConfig = async () => {
      if (isElectron && window.electronAPI?.setup?.getConfig) {
        try {
          const result = await window.electronAPI.setup.getConfig();
          if (result.success) {
            setSetupConfig(result.config);
          }
        } catch (e) {
          console.error('Failed to load setup config:', e);
        }
      } else {
        const isServer = localStorage.getItem('kwanza_is_server') === 'true';
        const serverConfig = localStorage.getItem('kwanza_server_config');
        const clientConfig = localStorage.getItem('kwanza_client_config');
        setSetupConfig({
          setupComplete: localStorage.getItem('kwanza_setup_complete') === 'true',
          role: isServer ? 'server' : (clientConfig ? 'client' : null),
          serverConfig: serverConfig ? JSON.parse(serverConfig) : null,
          clientConfig: clientConfig ? JSON.parse(clientConfig) : null,
        });
      }
    };
    void loadSetupConfig();
  }, [isElectron]);

  useEffect(() => {
    const focus = (location.state as { focus?: string } | null)?.focus;
    if (focus === 'password') {
      setActiveSection('general');
      requestAnimationFrame(() => {
        document.getElementById('change-password')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate, setActiveSection]);

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

    const unsubscribe = window.electronAPI?.updater.onStatus((data) => {
      setUpdateStatus(data);
      setIsChecking(data.status === 'checking');
      if (data.status === 'downloading') {
        setIsDownloading(true);
      } else if (data.status === 'downloaded' || data.status === 'error') {
        setIsDownloading(false);
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isElectron]);

  const handleCheckForUpdates = async () => {
    if (!isElectron) return;
    setIsChecking(true);
    setUpdateStatus({ status: 'checking' });
    try {
      const result = await window.electronAPI?.updater.check();
      if (!result?.success) {
        setUpdateStatus({ status: 'error', error: result?.error || 'Failed to check for updates' });
        return;
      }
      if (result.alreadyDownloaded && result.version) {
        setUpdateStatus({ status: 'downloaded', version: result.version });
      } else if (result.isUpdateAvailable && result.version) {
        setUpdateStatus({ status: 'available', version: result.version });
      } else {
        setUpdateStatus({ status: 'not-available' });
      }
    } catch {
      setUpdateStatus({ status: 'error', error: 'Failed to check for updates' });
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
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
        return;
      }
      const errText =
        result?.error || 'In-app download failed. Use "Download from GitHub" below.';
      setUpdateStatus({
        status: 'error',
        error: (result as { openedBrowser?: boolean })?.openedBrowser
          ? `${errText} Check your browser downloads folder.`
          : errText,
      });
    } catch {
      setUpdateStatus({
        status: 'error',
        error: 'In-app download failed. Use "Download from GitHub" below.',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenReleasePage = async () => {
    if (!isElectron) return;
    await window.electronAPI?.updater.openReleasePage?.();
  };

  const handleInstallUpdate = async () => {
    if (!isElectron) return;
    try {
      const result = await window.electronAPI?.updater.install();
      if (result && !result.success) {
        toast.error(result.error || 'Could not launch installer. Run the downloaded .exe manually.');
      }
    } catch {
      toast.error('Could not launch installer. Run the downloaded .exe manually.');
    }
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <ChangePasswordCard />
            <InteractionSettingsCard />
            <DailyTodosSettingsCard />
          </div>
        );
      case 'fiscal':
        return (
          <div className="space-y-6">
            <CertificationReadinessCard />
            <CompanySettingsLauncherCard />
            <SigningSettingsCard />
            <AgtSettingsCard />
            <AgtTransmissionsCard />
          </div>
        );
      case 'security':
        return (
          <div className="space-y-6">
            <SecuritySettingsCard />
          </div>
        );
      case 'system':
        return (
          <div className="grid gap-6 md:grid-cols-2">
            <AppInfoCard appVersion={appVersion} isElectron={isElectron} />
            <SoftwareUpdatesCard
              isElectron={isElectron}
              updateStatus={updateStatus}
              isChecking={isChecking}
              isDownloading={isDownloading}
              onCheck={handleCheckForUpdates}
              onDownload={handleDownloadUpdate}
              onInstall={handleInstallUpdate}
              onOpenReleasePage={handleOpenReleasePage}
            />
            <SetupConfigCard setupConfig={setupConfig} isElectron={isElectron} />
          </div>
        );
      case 'data':
        return (
          <div className="grid gap-6 md:grid-cols-2">
            <DeploymentHealthCard />
            <SyncHealthSettingsCard />
            <DatabaseBackupCard />
            <ClientSyncSettingsCard />
            <DataConsistencyCard />
          </div>
        );
      case 'advanced':
        return (
          <div className="grid gap-6 md:grid-cols-2">
            <NetworkSettingsCard />
            <HotUpdateSettingsCard />
            <BackendLogsCard />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.nav.settings}</h1>
        <p className="text-muted-foreground">{t.settingsPage.subtitle}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <SettingsSectionNav active={activeSection} onChange={setActiveSection} />

        <div className="min-w-0 flex-1">
          <SettingsSectionHeader section={activeSection} />
          {renderSectionContent()}
        </div>
      </div>
    </div>
  );
}
