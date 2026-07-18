import type { Branch } from '@/types/erp';
import { ALL_BRANCHES_SCOPE_ID } from '@/lib/branchAccess';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

export function resolveBranchScopeDisplayLabel(
  canSwitch: boolean,
  scopeId: string,
  operatingBranch: Branch | null,
  allBranchesLabel: string,
): string {
  // Sede shows its own name (sede warehouse). Only __all_branches__ uses the totals caption.
  if (canSwitch && String(scopeId || '') === ALL_BRANCHES_SCOPE_ID) {
    return allBranchesLabel;
  }
  if (operatingBranch) return formatBranchDisplayName(operatingBranch);
  return allBranchesLabel;
}

export { ALL_BRANCHES_SCOPE_ID };
