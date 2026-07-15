import { useEffect } from 'react';
import { invalidateElectronApiBaseCache } from '@/lib/api/config';
import { hydrateCompanySettingsFromServer } from '@/lib/companySettings';
import { onTableSync, realtimeSocket } from '@/lib/realtime/socket';
import {
  refreshAllSyncedTables,
  refreshCoreSyncedTables,
  scheduleTableRefresh,
  TABLE_REFRESH_EVENT,
  type RefreshableTable,
} from '@/lib/realtime/tableRefreshBridge';

const SOCKET_WATCH_MS = 30_000;
const RECONNECT_POLL_MS = 15_000;
const SOFT_REFRESH_MS = 1_800_000; // 30 min — light safety refresh (core tables only)

function isLanClient(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('kwanza_client_config');
    if (raw) {
      const cfg = JSON.parse(raw) as { serverIp?: string };
      if (cfg?.serverIp?.trim()) return true;
    }
  } catch {
    /* ignore */
  }
  return !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
}

/**
 * Keeps LAN clients in sync with the server: Socket.IO table updates + reconnect + periodic safety refresh.
 */
export function useRealtimeSyncBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    realtimeSocket.connect();

    const unsubs = [
      onTableSync('sales', (p) => scheduleTableRefresh('sales', p.entityId)),
      onTableSync('products', (p) => scheduleTableRefresh('products', p.entityId)),
      onTableSync('clients', (p) => scheduleTableRefresh('clients', p.entityId)),
      onTableSync('suppliers', (p) => scheduleTableRefresh('suppliers', p.entityId)),
      onTableSync('categories', (p) => scheduleTableRefresh('categories', p.entityId)),
      onTableSync('branches', (p) => scheduleTableRefresh('branches', p.entityId)),
      onTableSync('daily_reports', (p) => scheduleTableRefresh('daily_reports', p.entityId)),
      onTableSync('stock_transfers', (p) => scheduleTableRefresh('stock_transfers', p.entityId)),
      onTableSync('purchase_orders', (p) => scheduleTableRefresh('purchase_orders', p.entityId)),
      onTableSync('supplier_returns', (p) => scheduleTableRefresh('supplier_returns', p.entityId)),
      onTableSync('payments', (p) => scheduleTableRefresh('payments', p.entityId)),
      onTableSync('journal_entries', (p) => scheduleTableRefresh('journal_entries', p.entityId)),
      onTableSync('expenses', (p) => scheduleTableRefresh('expenses', p.entityId)),
      onTableSync('company_settings', () => {
        void hydrateCompanySettingsFromServer();
        scheduleTableRefresh('company_settings');
      }),
      onTableSync('credit_notes', (p) => scheduleTableRefresh('credit_notes', p.entityId)),
      onTableSync('debit_notes', (p) => scheduleTableRefresh('debit_notes', p.entityId)),
      onTableSync('purchase_invoices', (p) => scheduleTableRefresh('purchase_invoices', p.entityId)),
      onTableSync('caixas', (p) => scheduleTableRefresh('caixas', p.entityId)),
      onTableSync('caixa_sessions', (p) => scheduleTableRefresh('caixa_sessions', p.entityId)),
      onTableSync('chart_of_accounts', (p) => scheduleTableRefresh('chart_of_accounts', p.entityId)),
    ];

    const onBackendStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: string }>).detail;
      if (detail?.state === 'restarted' || detail?.state === 'healthy') {
        invalidateElectronApiBaseCache();
        realtimeSocket.connect();
        void hydrateCompanySettingsFromServer();
        refreshAllSyncedTables();
      }
    };
    window.addEventListener('backend:status', onBackendStatus as EventListener);

    let wasConnected = realtimeSocket.isConnected();
    const socketWatch = window.setInterval(() => {
      const connected = realtimeSocket.isConnected();
      if (!wasConnected && connected) {
        invalidateElectronApiBaseCache();
        void hydrateCompanySettingsFromServer();
        refreshAllSyncedTables();
      }
      wasConnected = connected;
    }, SOCKET_WATCH_MS);

    const reconnectPoll = window.setInterval(() => {
      if (!isLanClient()) return;
      if (!realtimeSocket.isConnected()) {
        invalidateElectronApiBaseCache();
        realtimeSocket.connect();
      }
    }, RECONNECT_POLL_MS);

    const softRefresh = window.setInterval(() => {
      if (!isLanClient()) return;
      refreshCoreSyncedTables();
    }, SOFT_REFRESH_MS);

  return () => {
      for (const unsub of unsubs) unsub();
      window.removeEventListener('backend:status', onBackendStatus as EventListener);
      window.clearInterval(socketWatch);
      window.clearInterval(reconnectPoll);
      window.clearInterval(softRefresh);
    };
  }, [enabled]);
}

/** Listen for a specific server table refresh in a hook. */
export function useTableRefreshListener(
  tables: RefreshableTable | RefreshableTable[],
  onRefresh: () => void,
) {
  const tableSet = Array.isArray(tables) ? tables : [tables];

  useEffect(() => {
    const handler = (event: Event) => {
      const table = (event as CustomEvent<{ table?: RefreshableTable }>).detail?.table;
      if (table && tableSet.includes(table)) {
        onRefresh();
      }
    };
    window.addEventListener(TABLE_REFRESH_EVENT, handler as EventListener);
    return () => window.removeEventListener(TABLE_REFRESH_EVENT, handler as EventListener);
  }, [onRefresh, tableSet.join(',')]);
}

export { TABLE_REFRESH_EVENT };
