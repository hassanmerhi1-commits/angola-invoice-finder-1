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
  | 'company_settings';

type TableListener = (payload: { table: TableName; ts?: number; entityId?: string }) => void;

class RealtimeSocket {
  private socket: Socket | null = null;
  private listeners: Map<TableName, Set<TableListener>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 12;
  private isConnecting = false;
  private useLegacyWs = false;

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

  connect(): void {
    if (this.socket?.connected || this.isConnecting) return;
    this.isConnecting = true;

    void this.resolveApiBase().then((apiBase) => {
      const url = apiBase.replace(/\/$/, '');
      console.log(`[Socket.IO] Connecting to ${url}...`);

      this.socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 2000,
      });

      this.socket.on('connect', () => {
        console.log('[Socket.IO] Connected');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
      });

      this.socket.on('table-update', (message: { table?: TableName; ts?: number; entityId?: string }) => {
        if (!message?.table) return;
        console.log(`[Socket.IO] table-update: ${message.table}`);
        this.notifyListeners(message.table, message);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket.IO] disconnected:', reason);
        this.isConnecting = false;
      });

      this.socket.on('connect_error', (err) => {
        console.warn('[Socket.IO] connect_error:', err.message);
        this.isConnecting = false;
        if (!this.useLegacyWs) {
          this.reconnectAttempts += 1;
        }
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.listeners.clear();
    this.reconnectAttempts = this.maxReconnectAttempts;
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
