import { useBranchScope } from '@/hooks/useBranchScope';
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
  const { branches, currentBranch, canSwitchBranch, setOperatingBranch } = useBranchScope();
  const { t } = useTranslation();

  if (!currentBranch || branches.length === 0) {
    return null;
  }

  if (!canSwitchBranch) {
    return (
      <div
        className={`flex items-center gap-2 truncate rounded-md border bg-muted/40 px-2 ${
          compact ? 'h-8 text-xs w-[180px]' : 'h-9 w-[220px] text-sm'
        } ${className}`}
      >
        <Building2 className={compact ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0'} />
        <span className="truncate">{formatBranchDisplayName(currentBranch)}</span>
      </div>
    );
  }

  return (
    <Select
      value={currentBranch.id}
      onValueChange={(branchId) => {
        const branch = branches.find((b) => b.id === branchId);
        if (branch) setOperatingBranch(branch);
      }}
    >
      <SelectTrigger className={`${compact ? 'h-8 text-xs w-[180px]' : 'w-[220px]'} ${className}`}>
        <div className="flex items-center gap-2 truncate">
          <Building2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
          <SelectValue placeholder={t.branchUi.selectBranch}>
            <span className="truncate">{formatBranchDisplayName(currentBranch)}</span>
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
