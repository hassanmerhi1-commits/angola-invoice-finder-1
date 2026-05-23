import type { Branch } from '@/types/erp';
import { ALL_BRANCHES_SCOPE_ID, isConsolidatedBranchScope } from '@/lib/branchAccess';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

export function resolveBranchScopeDisplayLabel(
  canSwitch: boolean,
  scopeId: string,
  operatingBranch: Branch | null,
  allBranchesLabel: string,
): string {
  if (canSwitch && isConsolidatedBranchScope(canSwitch, scopeId)) {
    return allBranchesLabel;
  }
  if (operatingBranch) return formatBranchDisplayName(operatingBranch);
  return allBranchesLabel;
}

export { ALL_BRANCHES_SCOPE_ID };
