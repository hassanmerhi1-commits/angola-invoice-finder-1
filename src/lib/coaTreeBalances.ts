import { Account } from '@/types/accounting';

/** Stable map key for COA ids (UUID case / driver string vs object). */
export function coaIdKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

/** Direct children by parent_id (O(n) once). */
export function buildChildrenByParentId(accounts: Account[]): Map<string, Account[]> {
  const map = new Map<string, Account[]>();
  for (const a of accounts) {
    const pid = coaIdKey(a.parent_id);
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
  const byId = new Map(accounts.map((a) => [coaIdKey(a.id), a]));
  const childrenByParent = buildChildrenByParentId(accounts);

  // Prefix descendants for incomplete parent links — only for headers / short codes.
  const prefixKids = new Map<string, Account[]>();
  const prefixRoots = accounts.filter(
    (a) => a.is_header || String(a.code || '').length <= 3 || (childrenByParent.get(coaIdKey(a.id))?.length ?? 0) > 0,
  );
  if (prefixRoots.length > 0) {
    for (const other of accounts) {
      const otherCode = String(other.code || '');
      if (!otherCode) continue;
      for (const acc of prefixRoots) {
        if (coaIdKey(other.id) === coaIdKey(acc.id) || coaIdKey(other.parent_id) === coaIdKey(acc.id)) continue;
        const code = String(acc.code || '');
        if (otherCode.length > code.length && otherCode.startsWith(code)) {
          const list = prefixKids.get(coaIdKey(acc.id));
          if (list) list.push(other);
          else prefixKids.set(coaIdKey(acc.id), [other]);
        }
      }
    }
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const roll = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return Number(byId.get(coaIdKey(id))?.current_balance) || 0;
    visiting.add(id);
    const acc = byId.get(coaIdKey(id));
    if (!acc) {
      visiting.delete(id);
      return 0;
    }
    let sum = Number(acc.current_balance) || 0;
    const seen = new Set<string>();
    for (const kid of [...(childrenByParent.get(coaIdKey(id)) || []), ...(prefixKids.get(coaIdKey(id)) || [])]) {
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

/**
 * Every filtered account must appear as a root or a child. parent_id mismatches
 * (UUID case/format) used to nest a supplier under 321 and then fail to find
 * the children list — the row existed in the API and never painted.
 */
export function buildVisibleCoaForest(accounts: Account[]): {
  roots: Account[];
  childrenByParent: Map<string, Account[]>;
} {
  const byId = new Map(accounts.map((a) => [coaIdKey(a.id), a]));
  const childrenByParent = new Map<string, Account[]>();
  const placed = new Set<string>();

  const attach = (parentKey: string, child: Account) => {
    const list = childrenByParent.get(parentKey);
    if (list) list.push(child);
    else childrenByParent.set(parentKey, [child]);
    placed.add(coaIdKey(child.id));
  };

  // Only nest under a parent that is actually in this list.
  for (const a of accounts) {
    const pid = coaIdKey(a.parent_id);
    if (pid && pid !== coaIdKey(a.id) && byId.has(pid)) attach(pid, a);
  }

  // A row whose parent is absent — filtered out by a search, or a broken parent_id —
  // still has to appear. Nest it under the closest ancestor by PGC code, else promote
  // it to a root. Registering it under a missing parent dropped it from the tree.
  for (const a of accounts) {
    if (placed.has(coaIdKey(a.id))) continue;
    const code = String(a.code || '');
    if (!code) continue;
    let best: Account | null = null;
    for (const cand of accounts) {
      if (coaIdKey(cand.id) === coaIdKey(a.id)) continue;
      const cCode = String(cand.code || '');
      if (!cCode || code.length <= cCode.length || !code.startsWith(cCode)) continue;
      if (!best || String(best.code || '').length < cCode.length) best = cand;
    }
    if (best) attach(coaIdKey(best.id), a);
  }

  const roots = accounts.filter((a) => !placed.has(coaIdKey(a.id)));
  return { roots, childrenByParent };
}

/** Any row that has nested children — including PGC “leaves” like 311/321. */
export function idsOfAccountsWithChildren(
  accounts: Account[],
  childrenByParent: Map<string, Account[]>,
): string[] {
  const ids: string[] = [];
  for (const a of accounts) {
    if ((childrenByParent.get(coaIdKey(a.id))?.length ?? 0) > 0) {
      ids.push(coaIdKey(a.id));
    }
  }
  return ids;
}

/** Walk parent_id so a new leaf (supplier, caixa, bank, …) is not left under a collapsed row. */
export function ancestorIdsOf(account: Account, byId: Map<string, Account>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let pid = coaIdKey(account.parent_id);
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    ids.push(pid);
    const parent = byId.get(pid);
    if (!parent) break;
    pid = coaIdKey(parent.parent_id);
  }
  return ids;
}
