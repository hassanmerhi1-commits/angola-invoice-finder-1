import React, { Suspense } from "react";
import { invalidateElectronApiBaseCache, clearStaleClientConfigIfServerMachine } from "@/lib/api/config";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner, toast } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useERP";
import { LanguageProvider, useLanguage } from "@/i18n";
import { BranchProvider } from "@/contexts/BranchContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { RoutePermissionGuard } from "@/components/RoutePermissionGuard";
import { PrintPreviewHost } from "@/components/print/PrintPreviewHost";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { UpdateStatus } from "@/types/electron";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import POS from "./pages/POS";
import Invoices from "./pages/Invoices";
const Inventory = React.lazy(() => import("./pages/Inventory"));

function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
import DailyReports from "./pages/DailyReports";
import Clients from "./pages/Clients";
import StockTransfer from "./pages/StockTransfer";
import DataSync from "./pages/DataSync";
import Suppliers from "./pages/Suppliers";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseInvoices from "./pages/PurchaseInvoices";
import Categories from "./pages/Categories";
import FiscalDocuments from "./pages/FiscalDocuments";
import ProForma from "./pages/ProForma";
import UserManagement from "./pages/UserManagement";
import Reports from "./pages/Reports";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import Journals from "./pages/Journals";
import Extracto from "./pages/Extracto";
import HRModule from "./pages/HRModule";
import ProductionModule from "./pages/ProductionModule";
import ImportModule from "./pages/ImportModule";
import Branches from "./pages/Branches";
import Settings from "./pages/Settings";
import Expenses from "./pages/Expenses";
import BankAccounts from "./pages/BankAccounts";
import CaixaManagement from "./pages/CaixaManagement";
import Vendas from "./pages/Vendas";
import PaymentsPage from "./pages/Payments";
import AccountingPeriods from "./pages/AccountingPeriods";
import TaxManagement from "./pages/TaxManagement";
import AuditTrail from "./pages/AuditTrail";
import BudgetControl from "./pages/BudgetControl";
import Approvals from "./pages/Approvals";
import ExchangeRates from "./pages/ExchangeRates";
import BankReconciliation from "./pages/BankReconciliation";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * Preserves `?query` when redirecting (e.g. legacy `#/purchase-invoices-window?mode=create`).
 * With HashRouter, `location.search` is sometimes empty even when the hash contains `?mode=…`
 * — recover from `window.location.hash` so Electron/deep links keep query params.
 */
function RedirectPreserveSearch({ to }: { to: string }) {
  const { search } = useLocation();
  let q = search;
  if (!q && typeof window !== "undefined") {
    const hash = window.location.hash || "";
    const qi = hash.indexOf("?");
    if (qi >= 0) q = hash.slice(qi);
  }
  const base = to.endsWith("/") ? to.slice(0, -1) : to;
  return <Navigate to={`${base}${q}`} replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function readSetupCompleteFromStorage(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem('kwanza_setup_complete');
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* ignore */
  }
  return null;
}

function AppRoutes() {
  const { user } = useAuth();
  /** Avoid a blank/spinner-only first paint in extra Electron windows while setup IPC catches up. */
  const [setupComplete, setSetupComplete] = React.useState<boolean | null>(readSetupCompleteFromStorage);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;

  React.useEffect(() => {
    clearStaleClientConfigIfServerMachine();
    import('@/lib/api/config').then(({ syncLanClientConfigFromIpFile }) => {
      syncLanClientConfigFromIpFile();
    }).catch(() => {});
    import('@/lib/lanServerAddress').then(({ repairLanClientConfigStorage }) => {
      repairLanClientConfigStorage();
    }).catch(() => {});
    if (isElectron && window.electronAPI?.db?.ensureBackend) {
      void window.electronAPI.db.ensureBackend().catch(() => null);
    }
  }, [isElectron]);

  React.useEffect(() => {
    let isMounted = true;

    const check = async () => {
      try {
        if (isElectron && window.electronAPI?.setup?.getConfig) {
          const snapRoleKeys = () => ({
            client: localStorage.getItem('kwanza_client_config'),
            isServer: localStorage.getItem('kwanza_is_server'),
          });
          const beforeRole = snapRoleKeys();

          const setup = await window.electronAPI.setup.getConfig();
          const cfg = setup?.success ? setup.config : null;
          const complete = !!cfg?.setupComplete;

          if (!isMounted) return;

          // Keep local flags in sync for legacy screens (Settings/status cards)
          localStorage.setItem('kwanza_setup_complete', complete ? 'true' : 'false');

          if (complete) {
            let isServer = cfg?.role === 'server';
            try {
              const ip = window.electronAPI?.ipfile?.parseSync?.();
              if (ip?.valid && ip.isServer) isServer = true;
              else if (ip?.valid && !ip.isServer && ip.serverAddress) isServer = false;
            } catch {
              /* IP file wins over stale setup-config.json */
            }
            localStorage.setItem('kwanza_is_server', isServer ? 'true' : 'false');
            if (isServer && cfg?.serverConfig?.databasePath) {
              localStorage.setItem('kwanza_server_config', JSON.stringify({ databasePath: cfg.serverConfig.databasePath }));
              localStorage.removeItem('kwanza_client_config');
            } else if (!isServer && cfg?.clientConfig?.serverIp) {
              const parsed = (await import('@/lib/lanServerAddress')).parseLanServerEndpoint(cfg.clientConfig.serverIp);
              localStorage.setItem(
                'kwanza_client_config',
                JSON.stringify({
                  serverIp: parsed.host || cfg.clientConfig.serverIp,
                  httpPort: cfg.clientConfig.httpPort ?? parsed.port ?? 3000,
                  serverPort: cfg.clientConfig.serverPort || 4546,
                }),
              );
              localStorage.removeItem('kwanza_server_config');
            }
          } else {
            localStorage.removeItem('kwanza_is_server');
            localStorage.removeItem('kwanza_server_config');
            localStorage.removeItem('kwanza_client_config');
          }

          const afterRole = snapRoleKeys();
          if (beforeRole.client !== afterRole.client || beforeRole.isServer !== afterRole.isServer) {
            invalidateElectronApiBaseCache();
          }

          setSetupComplete(complete);
          return;
        }

        // Non-Electron (web preview): auto-enable demo mode
        if (!isElectron) {
          localStorage.setItem('kwanza_setup_complete', 'true');
          localStorage.setItem('kwanza_connection_mode', 'demo');
          if (isMounted) setSetupComplete(true);
          return;
        }

        const flag = localStorage.getItem('kwanza_setup_complete');
        if (flag === 'true') {
          if (isMounted) setSetupComplete(true);
          return;
        }
        // IP file alone counts as configured (manual client/server install without setup wizard)
        try {
          const ip = window.electronAPI?.ipfile?.parseSync?.();
          if (ip?.valid) {
            localStorage.setItem('kwanza_setup_complete', 'true');
            if (ip.isServer) {
              localStorage.setItem('kwanza_is_server', 'true');
            } else if (ip.serverAddress) {
              localStorage.setItem('kwanza_is_server', 'false');
              const { syncLanClientConfigFromIpFile } = await import('@/lib/api/config');
              syncLanClientConfigFromIpFile();
            }
            if (isMounted) setSetupComplete(true);
            return;
          }
        } catch {
          /* ignore */
        }
        if (isMounted) setSetupComplete(false);
      } catch {
        const flag = localStorage.getItem('kwanza_setup_complete');
        if (isMounted) setSetupComplete(flag === 'true');
      }
    };

    check();
    const interval = setInterval(check, 700);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isElectron]);

  if (setupComplete === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <Routes>
      <Route 
        path="/setup" 
        element={setupComplete ? <Navigate to="/login" replace /> : <Setup />} 
      />
      <Route 
        path="/login" 
        element={
          !setupComplete ? <Navigate to="/setup" replace /> :
          user ? <Navigate to="/" replace /> : <Login />
        } 
      />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route element={<RoutePermissionGuard />}>
        <Route path="/" element={!setupComplete ? <Navigate to="/setup" replace /> : <Dashboard />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/vendas" element={<Vendas />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route
          path="/inventory"
          element={(
            <Suspense fallback={<RouteLoadingFallback />}>
              <Inventory />
            </Suspense>
          )}
        />
        <Route path="/categories" element={<Categories />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        {/* Must be before `/purchase-invoices` — distinct route gives reliable HashRouter navigation for “Nova fatura”. */}
        <Route path="/purchase-invoices/new" element={<PurchaseInvoices />} />
        <Route path="/purchase-invoices" element={<PurchaseInvoices />} />
        <Route path="/daily-reports" element={<DailyReports />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/stock-transfer" element={<StockTransfer />} />
        <Route path="/data-sync" element={<DataSync />} />
        <Route path="/fiscal-documents" element={<FiscalDocuments />} />
        <Route path="/proforma" element={<ProForma />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="/journals" element={<Journals />} />
        <Route path="/extracto" element={<Extracto />} />
        <Route path="/accounting" element={<Branches />} />
        <Route path="/customers" element={<Clients />} />
        <Route path="/branches" element={<Branches />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/bank-accounts" element={<BankAccounts />} />
        <Route path="/caixa" element={<CaixaManagement />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/hr" element={<HRModule />} />
        <Route path="/production" element={<ProductionModule />} />
        <Route path="/import" element={<ImportModule />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/accounting-periods" element={<AccountingPeriods />} />
        <Route path="/tax-management" element={<TaxManagement />} />
        <Route path="/audit-trail" element={<AuditTrail />} />
        <Route path="/budget-control" element={<BudgetControl />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/exchange-rates" element={<ExchangeRates />} />
        <Route path="/bank-reconciliation" element={<BankReconciliation />} />
        </Route>
      </Route>
      <Route path="/purchase-invoices-window" element={<RedirectPreserveSearch to="/purchase-invoices" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function LanguageKeyedRouter({ isElectron, browserBasename }: { isElectron: boolean; browserBasename?: string }) {
  const { language } = useLanguage();
  return isElectron ? (
    <HashRouter key={language}>
      <AppRoutes />
    </HashRouter>
  ) : (
    <BrowserRouter key={language} basename={browserBasename}>
      <AppRoutes />
    </BrowserRouter>
  );
}

const App = () => {
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;
  const browserBasename = !isElectron && typeof window !== 'undefined' && window.location.pathname.startsWith('/app')
    ? '/app'
    : undefined;

  const [updateReadyVersion, setUpdateReadyVersion] = React.useState<string | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = React.useState(false);
  const [installingUpdate, setInstallingUpdate] = React.useState(false);

  const handleInstallUpdate = React.useCallback(() => {
    setInstallingUpdate(true);
    void window.electronAPI?.updater?.install?.();
  }, []);

  React.useEffect(() => {
    if (!isElectron) return;
    const api = (window as any).electronAPI;
    if (!api?.backend?.onStatus) return;
    const onBackendEvent = () => {
      invalidateElectronApiBaseCache();
    };
    api.backend.onStatus(onBackendEvent);
  }, [isElectron]);

  React.useEffect(() => {
    if (!isElectron) return;
    const updater = window.electronAPI?.updater;
    if (!updater?.onStatus) return;

    let unsubscribed = false;
    const UPDATE_TOAST_ID = "nexor-update";

    const notify = (s: UpdateStatus) => {
      if (unsubscribed) return;

      if (s.status === "available") {
        const dismissed = sessionStorage.getItem("nexor_update_dismissed");
        if (dismissed === s.version) return;

        toast.dismiss(UPDATE_TOAST_ID);
        toast("Update available", {
          id: UPDATE_TOAST_ID,
          description: s.version ? `Version ${s.version} is ready to download.` : "A new version is ready to download.",
          duration: Infinity,
          action: {
            label: "Download",
            onClick: () => {
              void updater.download?.();
            },
          },
          cancel: {
            label: "Later",
            onClick: () => {
              if (s.version) sessionStorage.setItem("nexor_update_dismissed", s.version);
              toast.dismiss(UPDATE_TOAST_ID);
            },
          },
        });
      } else if (s.status === "downloaded") {
        toast.dismiss(UPDATE_TOAST_ID);
        setUpdateReadyVersion(s.version ?? null);
        setUpdateDialogOpen(true);
      } else if (s.status === "error") {
        toast("Update check failed", {
          description: s.error || "Could not check for updates.",
        });
      }
    };

    const unsubscribe = updater.onStatus((data: any) => {
      if (!data || typeof data !== "object") return;
      notify(data as UpdateStatus);
    });

    return () => {
      unsubscribed = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [isElectron]);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ErrorBoundary>
          <BranchProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <PrintPreviewHost />
              <LanguageKeyedRouter isElectron={isElectron} browserBasename={browserBasename} />
              <AlertDialog
                open={updateDialogOpen}
                onOpenChange={(open) => {
                  if (!installingUpdate) setUpdateDialogOpen(open);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Update ready to install</AlertDialogTitle>
                    <AlertDialogDescription>
                      {updateReadyVersion
                        ? `Version ${updateReadyVersion} has finished downloading.`
                        : "The update has finished downloading."}{" "}
                      The app will restart to apply the update.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={installingUpdate}>Later</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        handleInstallUpdate();
                      }}
                      disabled={installingUpdate}
                    >
                      {installingUpdate ? "Installing…" : "Install & restart"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TooltipProvider>
          </BranchProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </QueryClientProvider>
  );
};

export default App;