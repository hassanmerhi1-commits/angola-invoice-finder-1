/** Signed balance for supplier/customer open items (matches backend entityBalanceSql). */
export function isOpenItemDebit(isDebit: unknown): boolean {
  return isDebit === true || isDebit === 1 || isDebit === '1' || isDebit === 'true';
}

export function signedOpenItemBalance(oi: {
  remainingAmount: number;
  isDebit?: unknown;
}): number {
  const remaining = Number(oi.remainingAmount || 0);
  return isOpenItemDebit(oi.isDebit) ? remaining : -remaining;
}
