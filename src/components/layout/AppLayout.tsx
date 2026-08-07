// NEXOR ERP App Layout
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopNav } from './TopNav';
import { StatusBar } from './StatusBar';
import { BranchAccessGuard } from '@/components/BranchAccessGuard';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import { printCurrentPage } from '@/lib/printHtml';
import { AppInteractionProvider } from '@/components/interaction/AppInteractionProvider';
import { DailyTodoDialog } from '@/components/daily/DailyTodoDialog';
import { ensureDayTodos, shouldShowDailyTodoDialog, todayKey } from '@/lib/dailyTodos';
import { hydrateCompanySettingsFromServer } from '@/lib/companySettings';
import { useRealtimeSyncBridge } from '@/hooks/useRealtimeSyncBridge';
import { prefetchCoreRoutes } from '@/lib/routePrefetch';

function resolveAppPathname(pathname: string): string {
  const p = pathname.replace(/\/$/, '') || '/';
  return p;
}

export function AppLayout() {
  useBackendHealth();
  const { branches, currentBranch, setOperatingBranch } = useBranchScope();
  const { user, logout } = useAuth();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [dailyTodoOpen, setDailyTodoOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Cashiers stay on POS — daily checklist is for back-office roles only.
    if (user.role === 'cashier') return;
    if (shouldShowDailyTodoDialog()) {
      ensureDayTodos(todayKey());
      setDailyTodoOpen(true);
    }
  }, [user]);

  useRealtimeSyncBridge(!!user);

  // Prefetch main route chunks while the UI is idle so Inventory/POS/Purchases open faster.
  useEffect(() => {
    if (!user) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const run = () => prefetchCoreRoutes();
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(run, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(run, 1200);
    }
    return () => {
      if (idleId != null && typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [user]);

  // Keep the shared company profile (name, NIF, address, logo, ...) in sync with the
  // server: hydrate once after login, then refetch whenever any terminal updates it.
  useEffect(() => {
    if (!user) return;
    void hydrateCompanySettingsFromServer();
  }, [user]);

  useEffect(() => {
    if (user?.role === 'cashier') return;
    const onShow = () => {
      ensureDayTodos(todayKey());
      setDailyTodoOpen(true);
    };
    window.addEventListener('nexor:show-daily-todos', onShow);
    return () => window.removeEventListener('nexor:show-daily-todos', onShow);
  }, [user?.role]);

  useEffect(() => {
    const onGlobalPrint = () => {
      const p = resolveAppPathname(location.pathname);
      if (p === '/invoices' || p.startsWith('/invoices/')) {
        return;
      }
      if (p === '/reports' || p.startsWith('/reports/')) {
        printCurrentPage();
        return;
      }
      toast.info(t.topNav.file.printUnavailablePage);
    };

    window.addEventListener(NEXOR_TOOLBAR.DOCUMENTS_PRINT, onGlobalPrint);
    return () => window.removeEventListener(NEXOR_TOOLBAR.DOCUMENTS_PRINT, onGlobalPrint);
  }, [location.pathname, t.topNav.file.printUnavailablePage, toast]);

  return (
    <div className="h-screen flex flex-col bg-slate-50/50 overflow-hidden">
      <BranchAccessGuard />
      <div data-topnav>
        <TopNav
          user={user}
          branches={branches}
          currentBranch={currentBranch}
          onBranchChange={setOperatingBranch}
          onLogout={logout}
        />
      </div>
      <main data-nexor-scale className="flex min-h-0 flex-1 flex-col overflow-auto">
        <AppInteractionProvider>
          <Outlet />
        </AppInteractionProvider>
      </main>
      <div data-statusbar>
        <StatusBar />
      </div>
      <DailyTodoDialog
        open={dailyTodoOpen && user?.role !== 'cashier'}
        onOpenChange={setDailyTodoOpen}
      />
    </div>
  );
}