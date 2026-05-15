/** React Router `location.state` — POS resets session when this flag is set (TopNav / Vendas → POS). */
export type NexorPosNewSaleLocationState = { nexorPosNewSale?: boolean };

export function readNexorPosNewSaleFlag(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  return Boolean((state as NexorPosNewSaleLocationState).nexorPosNewSale);
}

export const NEXOR_POS_NEW_SALE_NAV_STATE: NexorPosNewSaleLocationState = { nexorPosNewSale: true };
