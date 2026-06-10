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
    if (shouldShowDailyTodoDialog()) {
      ensureDayTodos(todayKey());
      setDailyTodoOpen(true);
    }
  }, [user]);

  useEffect(() => {
    const onShow = () => {
      ensureDayTodos(todayKey());
      setDailyTodoOpen(true);
    };
    window.addEventListener('nexor:show-daily-todos', onShow);
    return () => window.removeEventListener('nexor:show-daily-todos', onShow);
  }, []);

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
      <main className="flex min-h-0 flex-1 flex-col overflow-auto">
        <AppInteractionProvider>
          <Outlet />
        </AppInteractionProvider>
      </main>
      <div data-statusbar>
        <StatusBar />
      </div>
      <DailyTodoDialog open={dailyTodoOpen} onOpenChange={setDailyTodoOpen} />
    </div>
  );
}