import { Branch, User } from '@/types/erp';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Building2, User as UserIcon, LogOut, Settings, Menu } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { CompanyLogo } from '@/components/layout/CompanyLogo';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { useNavigate } from 'react-router-dom';
import { ServerConnectionIndicator } from '@/components/layout/ServerConnectionIndicator';
import { SyncPendingBadge } from '@/components/layout/SyncPendingBadge';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { BranchScopeSelectItems } from '@/components/BranchScopeSelectItems';
import { resolveBranchScopeDisplayLabel } from '@/lib/branchScopeDisplay';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

interface HeaderProps {
  user: User | null;
  branches: Branch[];
  currentBranch: Branch | null;
  onBranchChange: (branch: Branch) => void;
  onLogout: () => void;
  onMenuClick?: () => void;
}

export function Header({
  user,
  branches,
  currentBranch,
  onBranchChange,
  onLogout,
  onMenuClick,
}: HeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canSwitchBranch, scopeId, setOperatingScope } = useBranchScope();

  return (
    <header className="h-16 border-b bg-card px-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {onMenuClick && (
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
            <Menu className="w-5 h-5" />
          </Button>
        )}
        
        <CompanyLogo size="md" />
      </div>

      <div className="flex items-center gap-3">
        {/* Server Connection Indicator */}
        <ServerConnectionIndicator />
        <SyncPendingBadge />

        {/* Notifications */}
        <NotificationBell />

        {/* Language Switcher */}
        <LanguageSwitcher />
        {/* Branch Selector */}
        {canSwitchBranch ? (
          <Select value={scopeId} onValueChange={setOperatingScope}>
            <SelectTrigger className="w-[180px] hidden sm:flex">
              <Building2 className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t.nav.dashboard}>
                {resolveBranchScopeDisplayLabel(canSwitchBranch, scopeId, currentBranch, t.branchUi.allBranches)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <BranchScopeSelectItems branches={branches} />
            </SelectContent>
          </Select>
        ) : currentBranch ? (
          <div className="hidden sm:flex h-9 w-[180px] items-center gap-2 truncate rounded-md border bg-muted/40 px-3 text-sm">
            <Building2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{formatBranchDisplayName(currentBranch)}</span>
          </div>
        ) : null}

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <UserIcon className="w-4 h-4 text-primary" />
              </div>
              <span className="hidden sm:inline">{user?.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="w-4 h-4 mr-2" />
              {t.nav.settings}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout} className="text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              {t.nav.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
