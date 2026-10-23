// Helpers for the auto-generated chart-of-accounts ledger codes used by customer
// (31x) and supplier (32x) entity registries.
//
// A client/supplier "account number" is an 8-digit code built under a parent
// (e.g. 311 -> 31100001, 321 -> 32100001). The leaf codes are non-header; the
// grouping sub-accounts (321 -> 3211 -> 32111) stay compact and are headers.
//
// This mirrors `nextEntityAccountCode` in the backend routes so the form can show
// the exact number that will be assigned on save.

export const ENTITY_ACCOUNT_CODE_LENGTH = 8;
export const SUPPLIER_PARENT_CODE = '321';

type CodeLike = {
  code?: string | null;
  is_header?: boolean | null;
  name?: string | null;
  description?: string | null;
  parent_id?: string | null;
};

/**
 * Compute the next free 8-digit entity code under a parent (e.g. "311" -> "31100001").
 * Nested category leaves (32110001 under header 3211) are not counted when allocating
 * under 321.
 */
export function nextEntityAccountCode(parentCode: string, accounts: CodeLike[]): string {
  const parent = String(parentCode || '').trim();
  if (!parent) return '';
  const headers = (accounts || [])
    .filter((a) => a?.is_header)
    .map((a) => String(a.code || ''))
    .filter((code) => code.startsWith(parent) && code !== parent && code.length < ENTITY_ACCOUNT_CODE_LENGTH);
  const suffixLen = Math.max(1, ENTITY_ACCOUNT_CODE_LENGTH - parent.length);
  const maxSeq = (accounts || []).reduce((max, a) => {
    if (a?.is_header) return max;
    const code = String(a?.code || '');
    if (code.length !== ENTITY_ACCOUNT_CODE_LENGTH || !code.startsWith(parent)) return max;
    if (headers.some((h) => code.startsWith(h))) return max;
    const parsed = Number(code.slice(parent.length));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${parent}${String(maxSeq + 1).padStart(suffixLen, '0')}`;
}

/** Next compact header under a parent (321 → 3211, 45 → 451) that is not already used. */
export function nextCompactChildCode(parentCode: string, usedCodes: Array<string | { code?: string | null }>): string {
  const parent = String(parentCode || '').trim();
  const used = new Set(
    (usedCodes || []).map((item) => (typeof item === 'string' ? item : String(item?.code || '')).trim()),
  );
  let n = 1;
  while (used.has(`${parent}${n}`)) n += 1;
  return `${parent}${n}`;
}

export function isSupplierCategoryParent(code: string): boolean {
  const c = String(code || '').trim();
  return c === SUPPLIER_PARENT_CODE
    || (c.startsWith(SUPPLIER_PARENT_CODE) && c.length > SUPPLIER_PARENT_CODE.length && c.length < ENTITY_ACCOUNT_CODE_LENGTH);
}

export function findSupplierLeafAccount<T extends CodeLike>(
  accounts: T[],
  name: string,
  nif?: string | null,
): T | null {
  const wantName = String(name || '').trim().toLowerCase();
  const wantNif = String(nif || '').replace(/\s/g, '').toLowerCase();
  const leaves = (accounts || []).filter((a) => {
    const code = String(a.code || '');
    return code.startsWith(SUPPLIER_PARENT_CODE)
      && code.length > SUPPLIER_PARENT_CODE.length
      && !a.is_header;
  });
  if (wantNif) {
    const byNif = leaves.find((a) => String(a.description || '').toLowerCase().includes(wantNif));
    if (byNif) return byNif;
  }
  if (!wantName) return null;
  return leaves.find((a) => String(a.name || '').trim().toLowerCase() === wantName) || null;
}
