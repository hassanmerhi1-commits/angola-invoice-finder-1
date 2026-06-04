/** Global toolbar events — TopNav dispatches; pages subscribe. */
export const NEXOR_TOOLBAR = {
  NEW: 'nexor:toolbar-new',
  DELETE: 'nexor:toolbar-delete',
  EDIT: 'nexor:toolbar-edit',
  ALL: 'nexor:toolbar-all',
  FILTER: 'nexor:toolbar-filter',
  EXCEL: 'nexor:toolbar-excel',
  INVENTORY_TRANSFER: 'nexor:inventory-transfer',
  INVENTORY_ADJUST_EXIT: 'nexor:inventory-adjust-exit',
  INVENTORY_ENTRY: 'nexor:inventory-entry',
  INVENTORY_MIN_QTY: 'nexor:inventory-min-qty',
  DOCUMENTS_PRINT: 'nexor:documents-print',
  FISCAL_SAFT: 'nexor:fiscal-saft',
  POS_CHECKOUT: 'nexor:pos-checkout',
  POS_VOID: 'nexor:pos-void',
} as const;

export type NexorToolbarEvent = (typeof NEXOR_TOOLBAR)[keyof typeof NEXOR_TOOLBAR];

export function dispatchToolbarEvent(name: NexorToolbarEvent) {
  window.dispatchEvent(new CustomEvent(name));
}

export const NEXOR_SUPPLIERS_NEW = 'nexor:suppliers-new';
