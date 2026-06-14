import { Branch } from '@/types/erp';
import { useBranchScope } from '@/hooks/useBranchScope';
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { BranchScopeSelectItems } from '@/components/BranchScopeSelectItems';
import { resolveBranchFromScope } from '@/lib/branchAccess';
import { resolveBranchScopeDisplayLabel } from '@/lib/branchScopeDisplay';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

interface BranchSelectorProps {
  compact?: boolean;
  className?: string;
  /** Inventory toolbar: include "All branches" + per-branch stock. */
  includeAllBranches?: boolean;
  inventoryScopeId?: string;
  onInventoryScopeChange?: (scopeId: string) => void;
  /** Pass full branch list (inventory should use allBranches, not visibleBranches). */
  branchList?: Branch[];
}

export function BranchSelector({
  compact = false,
  className = '',
  includeAllBranches = false,
  inventoryScopeId,
  onInventoryScopeChange,
  branchList,
}: BranchSelectorProps) {
  const {
    branches: scopeBranches,
    currentBranch,
    scopeId: globalScopeId,
    canSwitchBranch,
    setOperatingScope,
  } = useBranchScope();
  const branches = branchList?.length ? branchList : scopeBranches;
  const { t } = useTranslation();

  const scopeId = includeAllBranches
    ? (inventoryScopeId != null && inventoryScopeId !== '' ? inventoryScopeId : globalScopeId)
    : globalScopeId;
  const onScopeChange = includeAllBranches && onInventoryScopeChange
    ? onInventoryScopeChange
    : setOperatingScope;

  if (!currentBranch || branches.length === 0) {
    return null;
  }

  const displayBranch = includeAllBranches
    ? resolveBranchFromScope(branches, scopeId) || currentBranch
    : currentBranch;

  const displayLabel = includeAllBranches
    ? resolveBranchScopeDisplayLabel(
        canSwitchBranch,
        scopeId,
        displayBranch,
        t.branchUi.allBranches,
      )
    : formatBranchDisplayName(currentBranch);

  if (!canSwitchBranch) {
    return (
      <div
        className={`flex items-center gap-2 truncate rounded-md border bg-muted/40 px-2 ${
          compact ? 'h-8 text-xs w-[180px]' : 'h-9 w-[220px] text-sm'
        } ${className}`}
      >
        <Building2 className={compact ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0'} />
        <span className="truncate">{displayLabel}</span>
      </div>
    );
  }

  return (
    <Select value={scopeId} onValueChange={onScopeChange}>
      <SelectTrigger className={`${compact ? 'h-8 text-xs w-[200px]' : 'w-[240px]'} ${className}`}>
        <div className="flex items-center gap-2 truncate">
          <Building2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
          <SelectValue placeholder={t.branchUi.selectBranch}>
            <span className="truncate">{displayLabel}</span>
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent className="bg-popover z-50">
        <BranchScopeSelectItems
          branches={branches}
          compact={compact}
          showAllBranchesOption={includeAllBranches}
        />
      </SelectContent>
    </Select>
  );
}
