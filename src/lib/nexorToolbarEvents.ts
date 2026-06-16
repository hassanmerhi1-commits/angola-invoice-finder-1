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
  INVENTORY_COUNT_SHEET: 'nexor:inventory-count-sheet',
  INVENTORY_RECONCILE: 'nexor:inventory-reconcile',
  INVENTORY_IMPORT: 'nexor:inventory-import',
  INVENTORY_LABELS: 'nexor:inventory-labels',
  INVENTORY_ADJUST_STOCK: 'nexor:inventory-adjust-stock',
  DOCUMENTS_PRINT: 'nexor:documents-print',
  FISCAL_SAFT: 'nexor:fiscal-saft',
  POS_CHECKOUT: 'nexor:pos-checkout',
  POS_VOID: 'nexor:pos-void',
  CHART_NEW_CLIENT: 'nexor:chart-new-client',
  CHART_NEW_ACCOUNT: 'nexor:chart-new-account',
  /** Unified Chart of Accounts new menu — detail: { action: ChartNewAction } */
  CHART_NEW: 'nexor:chart-new',
} as const;

export type NexorToolbarEvent = (typeof NEXOR_TOOLBAR)[keyof typeof NEXOR_TOOLBAR];

export function dispatchToolbarEvent(name: NexorToolbarEvent) {
  window.dispatchEvent(new CustomEvent(name));
}

export function dispatchChartNew(action: import('./chartOfAccountsNewActions').ChartNewAction) {
  window.dispatchEvent(new CustomEvent(NEXOR_TOOLBAR.CHART_NEW, { detail: { action } }));
}

export const NEXOR_SUPPLIERS_NEW = 'nexor:suppliers-new';
