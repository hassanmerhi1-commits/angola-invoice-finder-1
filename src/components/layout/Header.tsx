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
import { useTranslation } from '@/i18n';
import { useNavigate } from 'react-router-dom';
import { ServerConnectionIndicator } from '@/components/layout/ServerConnectionIndicator';

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

        {/* Notifications */}
        <NotificationBell />

        {/* Language Switcher */}
        <LanguageSwitcher />
        {/* Branch Selector */}
        <Select
          value={currentBranch?.id}
          onValueChange={(id) => {
            const branch = branches.find(b => b.id === id);
            if (branch) onBranchChange(branch);
          }}
        >
          <SelectTrigger className="w-[180px] hidden sm:flex">
            <Building2 className="w-4 h-4 mr-2" />
            <SelectValue placeholder={t.nav.dashboard} />
          </SelectTrigger>
          <SelectContent>
            {branches.map(branch => (
              <SelectItem key={branch.id} value={branch.id}>
                <div className="flex items-center gap-2">
                  <span>{branch.name}</span>
                  {branch.isMain && (
                    <Badge variant="secondary" className="text-[10px]">Sede</Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
