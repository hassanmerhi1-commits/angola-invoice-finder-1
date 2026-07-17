import type { Branch } from '@/types/erp';
import { ALL_BRANCHES_SCOPE_ID } from '@/lib/branchAccess';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

export function resolveBranchScopeDisplayLabel(
  canSwitch: boolean,
  scopeId: string,
  operatingBranch: Branch | null,
  allBranchesLabel: string,
): string {
  // Keep "Sede Soyo" label when HQ is selected (still consolidated for data).
  // Only the explicit All-branches sentinel uses the all-branches caption.
  if (canSwitch && String(scopeId || '') === ALL_BRANCHES_SCOPE_ID) {
    return allBranchesLabel;
  }
  if (operatingBranch) return formatBranchDisplayName(operatingBranch);
  return allBranchesLabel;
}

export { ALL_BRANCHES_SCOPE_ID };
