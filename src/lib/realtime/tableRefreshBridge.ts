/**
 * Bridge server Socket.IO table-update events → local CustomEvents so all hooks refresh.
 * Without this, changes from another LAN client only appear after restart.
 */
import * as storage from '@/lib/storage';

export const TABLE_REFRESH_EVENT = 'nexor:table-refresh';

export type RefreshableTable =
  | 'branches'
  | 'products'
  | 'sales'
  | 'clients'
  | 'categories'
  | 'suppliers'
  | 'daily_reports'
  | 'stock_transfers'
  | 'purchase_orders'
  | 'supplier_returns'
  | 'payments'
  | 'journal_entries'
  | 'company_settings'
  | 'credit_notes'
  | 'debit_notes'
  | 'transport_documents'
  | 'purchase_invoices'
  | 'caixas'
  | 'caixa_sessions'
  | 'chart_of_accounts'
  | 'proformas'
  | 'expenses';

const TABLE_EVENT_MAP: Partial<Record<RefreshableTable, string>> = {
  sales: storage.SALES_CHANGED_EVENT,
  products: storage.PRODUCTS_CHANGED_EVENT,
  clients: storage.CLIENTS_CHANGED_EVENT,
  suppliers: storage.SUPPLIERS_CHANGED_EVENT,
  stock_transfers: storage.STOCK_TRANSFERS_CHANGED_EVENT,
  credit_notes: storage.CREDIT_NOTES_CHANGED_EVENT,
  payments: storage.OPEN_ITEMS_CHANGED_EVENT,
  expenses: 'nexor:expenses-changed',
  company_settings: 'company-settings-updated',
};

/** Tables that should also refresh products (stock / catalog). */
const ALSO_REFRESH_PRODUCTS = new Set<RefreshableTable>([
  'sales',
  'stock_transfers',
  'purchase_orders',
  'supplier_returns',
  'credit_notes',
  'purchase_invoices',
]);

const pendingTables = new Set<RefreshableTable>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function dispatchTableRefresh(table: RefreshableTable, entityId?: string) {
  const mapped = TABLE_EVENT_MAP[table];
  if (mapped) {
    if (mapped === 'company-settings-updated') {
      window.dispatchEvent(new Event('company-settings-updated'));
    } else {
      window.dispatchEvent(new CustomEvent(mapped, { detail: { entityId } }));
    }
  }
  if (ALSO_REFRESH_PRODUCTS.has(table) && table !== 'products') {
    const productsEvent = TABLE_EVENT_MAP.products;
    if (productsEvent) {
      window.dispatchEvent(new CustomEvent(productsEvent, { detail: { entityId, sourceTable: table } }));
    }
  }
  window.dispatchEvent(new CustomEvent(TABLE_REFRESH_EVENT, { detail: { table, entityId } }));
}

function flushPendingRefreshes() {
  flushTimer = null;
  const tables = Array.from(pendingTables);
  pendingTables.clear();
  for (const table of tables) {
    dispatchTableRefresh(table);
  }
}

/** Coalesce bursts (e.g. sale + products) into one UI refresh wave. */
export function scheduleTableRefresh(table: RefreshableTable, entityId?: string) {
  if (typeof window === 'undefined') return;
  pendingTables.add(table);
  if (entityId) {
    // Keep latest entity id on the set iteration — dispatch with last seen id per table is enough.
    void entityId;
  }
  if (flushTimer) return;
  flushTimer = window.setTimeout(flushPendingRefreshes, 250);
}

export function refreshAllSyncedTables() {
  if (typeof window === 'undefined') return;
  const all: RefreshableTable[] = [
    'branches',
    'products',
    'sales',
    'clients',
    'categories',
    'suppliers',
    'daily_reports',
    'purchase_orders',
    'credit_notes',
    'payments',
    'stock_transfers',
    'expenses',
    'company_settings',
    'journal_entries',
    'caixas',
    'caixa_sessions',
    'purchase_invoices',
  ];
  for (const table of all) {
    dispatchTableRefresh(table);
  }
}
