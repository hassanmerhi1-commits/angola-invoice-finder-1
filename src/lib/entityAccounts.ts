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

type CodeLike = { code?: string | null; is_header?: boolean | null };

/**
 * Compute the next free 8-digit entity code under a parent (e.g. "311" -> "31100001").
 * Only non-header codes directly numbered under the parent are considered, matching
 * the backend allocator.
 */
export function nextEntityAccountCode(parentCode: string, accounts: CodeLike[]): string {
  const parent = String(parentCode || '').trim();
  if (!parent) return '';
  const suffixLen = Math.max(1, ENTITY_ACCOUNT_CODE_LENGTH - parent.length);
  const maxSeq = (accounts || []).reduce((max, a) => {
    if (a?.is_header) return max;
    const code = String(a?.code || '');
    if (!code.startsWith(parent) || code.length <= parent.length) return max;
    const parsed = Number(code.slice(parent.length));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${parent}${String(maxSeq + 1).padStart(suffixLen, '0')}`;
}
