import { Branch } from '@/types/erp';
import { SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Building2, MapPin } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { ALL_BRANCHES_SCOPE_ID } from '@/lib/branchAccess';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

interface BranchScopeSelectItemsProps {
  branches: Branch[];
  compact?: boolean;
  /** Inventory only: first row = total stock across all branches. */
  showAllBranchesOption?: boolean;
}

export function BranchScopeSelectItems({
  branches,
  compact = false,
  showAllBranchesOption = false,
}: BranchScopeSelectItemsProps) {
  const { t } = useTranslation();
  const iconClass = compact ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <>
      {showAllBranchesOption && (
        <SelectItem value={ALL_BRANCHES_SCOPE_ID}>
          <div className="flex items-center gap-2">
            <Building2 className={`${iconClass} text-primary shrink-0`} />
            <span className="truncate">{t.branchUi.allBranches}</span>
          </div>
        </SelectItem>
      )}
      {branches.map((branch) => (
        <SelectItem key={branch.id} value={branch.id}>
          <div className="flex items-center gap-2">
            <MapPin className={`${iconClass} text-muted-foreground shrink-0`} />
            <span className="truncate">{formatBranchDisplayName(branch)}</span>
            {branch.isMain && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">
                {t.branchUi.headOffice}
              </Badge>
            )}
          </div>
        </SelectItem>
      ))}
    </>
  );
}
