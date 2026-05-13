// NEXOR ERP App Layout
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { StatusBar } from './StatusBar';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useERP';

export function AppLayout() {
  const { branches, currentBranch, setCurrentBranch } = useBranchContext();
  const { user, logout } = useAuth();

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div data-topnav>
        <TopNav
          user={user}
          branches={branches}
          currentBranch={currentBranch}
          onBranchChange={setCurrentBranch}
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