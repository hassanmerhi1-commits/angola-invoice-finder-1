// Real-time updates via Socket.io (Express server) — replaces legacy WS :4546 for LAN clients.

import { io, Socket } from 'socket.io-client';
import { getApiUrl } from '../api/config';

type TableName =
  | 'branches'
  | 'products'
  | 'sales'
  | 'users'
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

type TableListener = (payload: { table: TableName; ts?: number; entityId?: string }) => void;

class RealtimeSocket {
  private socket: Socket | null = null;
  private listeners: Map<TableName, Set<TableListener>> = new Map();
  private isConnecting = false;
  private manualReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private async resolveApiBase(): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getApiUrl) {
      try {
        return await (window as any).electronAPI.getApiUrl();
      } catch {
        /* fall through */
      }
    }
    return getApiUrl();
  }

  private clearManualReconnect() {
    if (this.manualReconnectTimer) {
      clearTimeout(this.manualReconnectTimer);
      this.manualReconnectTimer = null;
    }
  }

  private scheduleManualReconnect(delayMs = 3000) {
    if (this.manualReconnectTimer || this.socket?.connected) return;
    this.manualReconnectTimer = setTimeout(() => {
      this.manualReconnectTimer = null;
      if (!this.socket?.connected && this.listeners.size > 0) {
        this.isConnecting = false;
        this.connect();
      }
    }, delayMs);
  }

  connect(): void {
    if (this.socket?.connected || this.isConnecting) return;
    this.isConnecting = true;
    this.clearManualReconnect();

    void this.resolveApiBase().then((apiBase) => {
      const url = apiBase.replace(/\/$/, '');
      console.log(`[Socket.IO] Connecting to ${url}...`);

      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }

      this.socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 15000,
      });

      this.socket.on('connect', () => {
        console.log('[Socket.IO] Connected');
        this.isConnecting = false;
        this.clearManualReconnect();
      });

      this.socket.on('table-update', (message: { table?: string; ts?: number; entityId?: string }) => {
        if (!message?.table) return;
        const table = message.table as TableName;
        console.log(`[Socket.IO] table-update: ${table}`);
        this.notifyListeners(table, { ...message, table });
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket.IO] disconnected:', reason);
        this.isConnecting = false;
        if (reason === 'io server disconnect') {
          this.socket?.connect();
        } else {
          this.scheduleManualReconnect();
        }
      });

      this.socket.on('connect_error', (err) => {
        console.warn('[Socket.IO] connect_error:', err.message);
        this.isConnecting = false;
        this.scheduleManualReconnect(5000);
      });
    });
  }

  disconnect(): void {
    this.clearManualReconnect();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.listeners.clear();
    this.isConnecting = false;
  }

  subscribe(table: TableName, listener: TableListener): () => void {
    if (!this.listeners.has(table)) {
      this.listeners.set(table, new Set());
    }
    this.listeners.get(table)!.add(listener);
    this.connect();
    return () => {
      const set = this.listeners.get(table);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(table);
      }
    };
  }

  /** Force a new connection (e.g. after server URL change). */
  reconnect(): void {
    this.clearManualReconnect();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnecting = false;
    this.connect();
  }

  private notifyListeners(table: TableName, payload: { table: TableName; ts?: number; entityId?: string }) {
    const set = this.listeners.get(table);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (e) {
        console.error(`[Socket.IO] listener error (${table}):`, e);
      }
    }
  }

  isConnected(): boolean {
    return !!this.socket?.connected;
  }
}

export const realtimeSocket = new RealtimeSocket();

export function onTableSync(
  table: TableName,
  callback: (payload: { table: TableName; ts?: number; entityId?: string }) => void
): () => void {
  return realtimeSocket.subscribe(table, callback);
}
