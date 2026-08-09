import { Account } from '@/types/accounting';

/** Direct children by parent_id (O(n) once). */
export function buildChildrenByParentId(accounts: Account[]): Map<string, Account[]> {
  const map = new Map<string, Account[]>();
  for (const a of accounts) {
    const pid = String(a.parent_id || '').trim();
    if (!pid) continue;
    const list = map.get(pid);
    if (list) list.push(a);
    else map.set(pid, [a]);
  }
  return map;
}

/**
 * Rolled balances for tree display: own postings + descendants.
 * Includes PGC code-prefix descendants when parent_id links are incomplete.
 * Computed once per accounts list — never per-row on click.
 */
export function buildRolledBalanceById(accounts: Account[]): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const childrenByParent = buildChildrenByParentId(accounts);

  // Prefix descendants for incomplete parent links — only for headers / short codes.
  const prefixKids = new Map<string, Account[]>();
  const prefixRoots = accounts.filter(
    (a) => a.is_header || String(a.code || '').length <= 3 || (childrenByParent.get(a.id)?.length ?? 0) > 0,
  );
  if (prefixRoots.length > 0) {
    for (const other of accounts) {
      const otherCode = String(other.code || '');
      if (!otherCode) continue;
      for (const acc of prefixRoots) {
        if (other.id === acc.id || other.parent_id === acc.id) continue;
        const code = String(acc.code || '');
        if (otherCode.length > code.length && otherCode.startsWith(code)) {
          const list = prefixKids.get(acc.id);
          if (list) list.push(other);
          else prefixKids.set(acc.id, [other]);
        }
      }
    }
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const roll = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return Number(byId.get(id)?.current_balance) || 0;
    visiting.add(id);
    const acc = byId.get(id);
    if (!acc) {
      visiting.delete(id);
      return 0;
    }
    let sum = Number(acc.current_balance) || 0;
    const seen = new Set<string>();
    for (const kid of [...(childrenByParent.get(id) || []), ...(prefixKids.get(id) || [])]) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      sum += roll(kid.id);
    }
    visiting.delete(id);
    memo.set(id, sum);
    return sum;
  };

  for (const a of accounts) roll(a.id);
  return memo;
}
