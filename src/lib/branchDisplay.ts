import type { Branch } from '@/types/erp';

/** Names like "branch 1" / "filial 2" are placeholders — show code or a clearer label in UI. */
function isGenericBranchName(name: string, id?: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (id && n === id) return true;
  return /^(branch|filial)\s*\d+$/i.test(n);
}

/** Human-readable branch label for banners, selectors, and reports. */
export function formatBranchDisplayName(
  branch: Pick<Branch, 'name' | 'code' | 'id'> | null | undefined,
): string {
  if (!branch) return '';
  const name = String(branch.name || '').trim();
  const code = String(branch.code || '').trim();
  if (isGenericBranchName(name, branch.id) && code) return code;
  if (name && code && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`;
  return name || code || String(branch.id || '');
}
