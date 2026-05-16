import { useBranchContext } from '@/contexts/BranchContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

interface BranchSelectorProps {
  compact?: boolean;
  className?: string;
}

export function BranchSelector({ compact = false, className = '' }: BranchSelectorProps) {
  const { branches, currentBranch, setCurrentBranch } = useBranchContext();
  const { t } = useTranslation();

  const handleBranchChange = (branchId: string) => {
    const branch = branches.find(b => b.id === branchId);
    if (branch) {
      setCurrentBranch(branch);
    }
  };

  if (branches.length === 0) {
    return null;
  }

  return (
    <Select value={currentBranch?.id || ''} onValueChange={handleBranchChange}>
      <SelectTrigger className={`${compact ? 'h-8 text-xs w-[180px]' : 'w-[220px]'} ${className}`}>
        <div className="flex items-center gap-2 truncate">
          <Building2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
          <SelectValue placeholder={t.branchUi.selectBranch}>
            {currentBranch ? (
              <span className="truncate">{formatBranchDisplayName(currentBranch)}</span>
            ) : (
              t.branchUi.selectBranch
            )}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent className="bg-popover z-50">
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.id}>
            <div className="flex items-center gap-2">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <span className="truncate">{formatBranchDisplayName(branch)}</span>
              {branch.isMain && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">
                  {t.branchUi.headOffice}
                </Badge>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
