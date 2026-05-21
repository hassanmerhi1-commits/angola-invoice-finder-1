// NEXOR ERP App Layout
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { StatusBar } from './StatusBar';
import { BranchAccessGuard } from '@/components/BranchAccessGuard';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { useBackendHealth } from '@/hooks/useBackendHealth';

export function AppLayout() {
  useBackendHealth();
  const { branches, currentBranch, setOperatingBranch } = useBranchScope();
  const { user, logout } = useAuth();

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
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
        <Outlet />
      </main>
      <div data-statusbar>
        <StatusBar />
      </div>
    </div>
  );
}