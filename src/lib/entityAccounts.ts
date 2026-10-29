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

/** Posting accounts the category tabs list. Groups stay on the All tab. */
export function isEightDigitAccountCode(code: string | null | undefined): boolean {
  return /^\d{8}$/.test(String(code || '').trim());
}
export const SUPPLIER_PARENT_CODE = '321';
export const CASH_PARENT_CODE = '45';

type CodeLike = {
  code?: string | null;
  is_header?: boolean | null;
  name?: string | null;
  description?: string | null;
  parent_id?: string | null;
};

/**
 * Drop one 8-digit leaf and move every later leaf under the same parent down
 * one number. 11100003 becomes 11100002. A leaf under another group stays.
 */
export function shiftLeafCodesAfterDelete<T extends CodeLike & { id?: string | null; parent_id?: string | null }>(
  accounts: T[],
  deletedId: string,
): T[] {
  const deleted = (accounts || []).find((a) => String(a.id || '') === String(deletedId));
  const rest = (accounts || []).filter((a) => String(a.id || '') !== String(deletedId));
  const code = String(deleted?.code || '').trim();
  const parentId = deleted?.parent_id || null;
  const parentCode = String(
    (accounts || []).find((a) => parentId && String(a.id || '') === String(parentId))?.code || '',
  ).trim();
  if (!deleted || !parentCode || parentCode.length >= ENTITY_ACCOUNT_CODE_LENGTH || !/^\d{8}$/.test(code) || !code.startsWith(parentCode)) {
    return rest;
  }
  const deletedSeq = Number(code.slice(parentCode.length));
  const suffixLen = ENTITY_ACCOUNT_CODE_LENGTH - parentCode.length;
  return rest.map((account) => {
    if (String(account.parent_id || '') !== String(parentId) || account.is_header) return account;
    const current = String(account.code || '').trim();
    if (!/^\d{8}$/.test(current) || !current.startsWith(parentCode)) return account;
    const seq = Number(current.slice(parentCode.length));
    if (!Number.isFinite(seq) || seq <= deletedSeq) return account;
    return { ...account, code: `${parentCode}${String(seq - 1).padStart(suffixLen, '0')}` };
  });
}

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

/** 45 itself or a compact header under it (451, 4511), same shape as 321 → 3211. */
export function isCashCategoryParent(code: string): boolean {
  const c = String(code || '').trim();
  return c === CASH_PARENT_CODE
    || (c.startsWith(CASH_PARENT_CODE) && c.length > CASH_PARENT_CODE.length && c.length < ENTITY_ACCOUNT_CODE_LENGTH);
}

/** Any tab: 43, 431, 4311, 71, 7111… can parent an 8-digit child. */
export function isCompactCategoryParent(code: string): boolean {
  const c = String(code || '').trim();
  return /^\d+$/.test(c) && c.length >= 2 && c.length < ENTITY_ACCOUNT_CODE_LENGTH;
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
