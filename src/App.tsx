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

function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
}

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const POS = React.lazy(() => import("./pages/POS"));
const Invoices = React.lazy(() => import("./pages/Invoices"));
const Inventory = React.lazy(() => import("./pages/Inventory"));
const DailyReports = React.lazy(() => import("./pages/DailyReports"));
const Clients = React.lazy(() => import("./pages/Clients"));
const StockTransfer = React.lazy(() => import("./pages/StockTransfer"));
const DataSync = React.lazy(() => import("./pages/DataSync"));
const Suppliers = React.lazy(() => import("./pages/Suppliers"));
const PurchaseOrders = React.lazy(() => import("./pages/PurchaseOrders"));
const PurchaseInvoices = React.lazy(() => import("./pages/PurchaseInvoices"));
const Categories = React.lazy(() => import("./pages/Categories"));
const FiscalDocuments = React.lazy(() => import("./pages/FiscalDocuments"));
const ProForma = React.lazy(() => import("./pages/ProForma"));
const SalesOrders = React.lazy(() => import("./pages/SalesOrders"));
const UserManagement = React.lazy(() => import("./pages/UserManagement"));
const Reports = React.lazy(() => import("./pages/Reports"));
const ChartOfAccounts = React.lazy(() => import("./pages/ChartOfAccounts"));
const Journals = React.lazy(() => import("./pages/Journals"));
const Extracto = React.lazy(() => import("./pages/Extracto"));
const HRModule = React.lazy(() => import("./pages/HRModule"));
const ProductionModule = React.lazy(() => import("./pages/ProductionModule"));
const ImportModule = React.lazy(() => import("./pages/ImportModule"));
const Branches = React.lazy(() => import("./pages/Branches"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Expenses = React.lazy(() => import("./pages/Expenses"));
const BankAccounts = React.lazy(() => import("./pages/BankAccounts"));
const CaixaManagement = React.lazy(() => import("./pages/CaixaManagement"));
const Vendas = React.lazy(() => import("./pages/Vendas"));
const PaymentsPage = React.lazy(() => import("./pages/Payments"));
const ReceivablesPage = React.lazy(() => import("./pages/Receivables"));
const PayablesPage = React.lazy(() => import("./pages/Payables"));
const AccountingPeriods = React.lazy(() => import("./pages/AccountingPeriods"));
const TaxManagement = React.lazy(() => import("./pages/TaxManagement"));
const AuditTrail = React.lazy(() => import("./pages/AuditTrail"));
const BudgetControl = React.lazy(() => import("./pages/BudgetControl"));
const Approvals = React.lazy(() => import("./pages/Approvals"));
const ExchangeRates = React.lazy(() => import("./pages/ExchangeRates"));
const BankReconciliation = React.lazy(() => import("./pages/BankReconciliation"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

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
  const location = useLocation();
  
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

  // Force password change for seeded/default accounts before using the ERP.
  if (user.mustChangePassword) {
    const onSettings =
      location.pathname === '/settings'
      || location.pathname.endsWith('/settings');
    if (!onSettings) {
      return <Navigate to="/settings?focus=password" replace />;
    }
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

    let intervalId: ReturnType<typeof setInterval> | undefined;

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
          if (complete && intervalId) {
            clearInterval(intervalId);
            intervalId = undefined;
          }
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

    void check();
    intervalId = setInterval(() => { void check(); }, 2500);
    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
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
          user?.mustChangePassword ? <Navigate to="/settings?focus=password" replace /> :
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
        <Route
          path="/"
          element={
            !setupComplete ? <Navigate to="/setup" replace />
            : user?.role === 'cashier' ? <Navigate to="/pos" replace />
            : <LazyRoute><Dashboard /></LazyRoute>
          }
        />
        <Route path="/pos" element={<LazyRoute><POS /></LazyRoute>} />
        <Route path="/vendas" element={<LazyRoute><Vendas /></LazyRoute>} />
        <Route path="/invoices" element={<LazyRoute><Invoices /></LazyRoute>} />
        <Route path="/inventory" element={<LazyRoute><Inventory /></LazyRoute>} />
        <Route path="/categories" element={<LazyRoute><Categories /></LazyRoute>} />
        <Route path="/suppliers" element={<LazyRoute><Suppliers /></LazyRoute>} />
        <Route path="/purchase-orders" element={<LazyRoute><PurchaseOrders /></LazyRoute>} />
        <Route path="/purchase-invoices/new" element={<LazyRoute><PurchaseInvoices /></LazyRoute>} />
        <Route path="/purchase-invoices" element={<LazyRoute><PurchaseInvoices /></LazyRoute>} />
        <Route path="/daily-reports" element={<LazyRoute><DailyReports /></LazyRoute>} />
        <Route path="/clients" element={<LazyRoute><Clients /></LazyRoute>} />
        <Route path="/stock-transfer" element={<LazyRoute><StockTransfer /></LazyRoute>} />
        <Route path="/data-sync" element={<LazyRoute><DataSync /></LazyRoute>} />
        <Route path="/fiscal-documents" element={<LazyRoute><FiscalDocuments /></LazyRoute>} />
        <Route path="/proforma" element={<LazyRoute><ProForma /></LazyRoute>} />
        <Route path="/sales-orders" element={<LazyRoute><SalesOrders /></LazyRoute>} />
        <Route path="/users" element={<LazyRoute><UserManagement /></LazyRoute>} />
        <Route path="/chart-of-accounts" element={<LazyRoute><ChartOfAccounts /></LazyRoute>} />
        <Route path="/journals" element={<LazyRoute><Journals /></LazyRoute>} />
        <Route path="/extracto" element={<LazyRoute><Extracto /></LazyRoute>} />
        <Route path="/accounting" element={<LazyRoute><Branches /></LazyRoute>} />
        <Route path="/customers" element={<LazyRoute><Clients /></LazyRoute>} />
        <Route path="/branches" element={<LazyRoute><Branches /></LazyRoute>} />
        <Route path="/reports" element={<LazyRoute><Reports /></LazyRoute>} />
        <Route path="/expenses" element={<LazyRoute><Expenses /></LazyRoute>} />
        <Route path="/bank-accounts" element={<LazyRoute><BankAccounts /></LazyRoute>} />
        <Route path="/caixa" element={<LazyRoute><CaixaManagement /></LazyRoute>} />
        <Route path="/settings" element={<LazyRoute><Settings /></LazyRoute>} />
        <Route path="/hr" element={<LazyRoute><HRModule /></LazyRoute>} />
        <Route path="/production" element={<LazyRoute><ProductionModule /></LazyRoute>} />
        <Route path="/import" element={<LazyRoute><ImportModule /></LazyRoute>} />
        <Route path="/payments" element={<LazyRoute><PaymentsPage /></LazyRoute>} />
        <Route path="/receivables" element={<LazyRoute><ReceivablesPage /></LazyRoute>} />
        <Route path="/payables" element={<LazyRoute><PayablesPage /></LazyRoute>} />
        <Route path="/accounting-periods" element={<LazyRoute><AccountingPeriods /></LazyRoute>} />
        <Route path="/tax-management" element={<LazyRoute><TaxManagement /></LazyRoute>} />
        <Route path="/audit-trail" element={<LazyRoute><AuditTrail /></LazyRoute>} />
        <Route path="/budget-control" element={<LazyRoute><BudgetControl /></LazyRoute>} />
        <Route path="/approvals" element={<LazyRoute><Approvals /></LazyRoute>} />
        <Route path="/exchange-rates" element={<LazyRoute><ExchangeRates /></LazyRoute>} />
        <Route path="/bank-reconciliation" element={<LazyRoute><BankReconciliation /></LazyRoute>} />
        </Route>
      </Route>
      <Route path="/purchase-invoices-window" element={<RedirectPreserveSearch to="/purchase-invoices" />} />
      <Route path="*" element={<LazyRoute><NotFound /></LazyRoute>} />
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
    void window.electronAPI?.updater?.install?.().then((result) => {
      if (result && !result.success) {
        setInstallingUpdate(false);
        toast.error(result.error || 'Could not launch installer. Run the downloaded .exe manually.');
      }
    }).catch(() => {
      setInstallingUpdate(false);
      toast.error('Could not launch installer. Run the downloaded .exe manually.');
    });
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