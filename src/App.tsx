import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useERP";
import { LanguageProvider } from "@/i18n";
import { BranchProvider } from "@/contexts/BranchContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import POS from "./pages/POS";
import Invoices from "./pages/Invoices";
import Inventory from "./pages/Inventory";
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

function AppRoutes() {
  const { user } = useAuth();
  const [setupComplete, setSetupComplete] = React.useState<boolean | null>(null);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;

  React.useEffect(() => {
    let isMounted = true;

    const check = async () => {
      try {
        if (isElectron && window.electronAPI?.setup?.getConfig) {
          const setup = await window.electronAPI.setup.getConfig();
          const cfg = setup?.success ? setup.config : null;
          const complete = !!cfg?.setupComplete;

          if (!isMounted) return;

          // Keep local flags in sync for legacy screens (Settings/status cards)
          localStorage.setItem('kwanza_setup_complete', complete ? 'true' : 'false');

          if (complete) {
            const isServer = cfg?.role === 'server';
            localStorage.setItem('kwanza_is_server', isServer ? 'true' : 'false');
            if (isServer && cfg?.serverConfig?.databasePath) {
              localStorage.setItem('kwanza_server_config', JSON.stringify({ databasePath: cfg.serverConfig.databasePath }));
              localStorage.removeItem('kwanza_client_config');
            } else if (!isServer && cfg?.clientConfig?.serverIp) {
              localStorage.setItem('kwanza_client_config', JSON.stringify({ serverIp: cfg.clientConfig.serverIp, serverPort: cfg.clientConfig.serverPort || 4546 }));
              localStorage.removeItem('kwanza_server_config');
            }
          } else {
            localStorage.removeItem('kwanza_is_server');
            localStorage.removeItem('kwanza_server_config');
            localStorage.removeItem('kwanza_client_config');
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
        if (isMounted) setSetupComplete(flag === 'true');
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
        <Route path="/" element={!setupComplete ? <Navigate to="/setup" replace /> : <Dashboard />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/vendas" element={<Vendas />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
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
      <Route path="/purchase-invoices-window" element={<Navigate to="/purchase-invoices" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => {
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;
  const browserBasename = !isElectron && typeof window !== 'undefined' && window.location.pathname.startsWith('/app')
    ? '/app'
    : undefined;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <BranchProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              {isElectron ? (
                <HashRouter>
                  <AppRoutes />
                </HashRouter>
              ) : (
                <BrowserRouter basename={browserBasename}>
                  <AppRoutes />
                </BrowserRouter>
              )}
            </TooltipProvider>
          </BranchProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;