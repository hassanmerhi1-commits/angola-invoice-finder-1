// Real-time WebSocket connection for NEXOR ERP
// This handles live sync from the server - when data changes, ALL clients update instantly

import { getWsUrl } from '../api/config';

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
  | 'supplier_returns';

type TableListener = (data: any[]) => void;

class RealtimeSocket {
  private socket: WebSocket | null = null;
  private listeners: Map<TableName, Set<TableListener>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000;
  private isConnecting = false;

  // Connect to the server
  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    const wsUrl = getWsUrl();
    
    console.log(`[WS] Connecting to ${wsUrl}...`);
    
    try {
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = () => {
        console.log('[WS] ✅ Connected to server');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        
        // Request initial sync of all tables
        this.socket?.send(JSON.stringify({ type: 'request_sync' }));
      };
      
      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.table && message.data) {
            console.log(`[WS] Received ${message.table}: ${message.data.length} rows`);
            this.notifyListeners(message.table as TableName, message.data);
          }
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      };
      
      this.socket.onclose = (event) => {
        console.log(`[WS] Connection closed: ${event.code}`);
        this.isConnecting = false;
        this.socket = null;
        this.scheduleReconnect();
      };
      
      this.socket.onerror = (error) => {
        console.error('[WS] Error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('[WS] Failed to connect:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  // Disconnect from the server
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.listeners.clear();
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  // Schedule a reconnection attempt
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => this.connect(), delay);
  }

  // Subscribe to a table's changes
  subscribe(table: TableName, listener: TableListener): () => void {
    if (!this.listeners.has(table)) {
      this.listeners.set(table, new Set());
    }
    
    this.listeners.get(table)!.add(listener);
    
    // Connect if not already connected
    this.connect();
    
    // Return unsubscribe function
    return () => {
      const tableListeners = this.listeners.get(table);
      if (tableListeners) {
        tableListeners.delete(listener);
        if (tableListeners.size === 0) {
          this.listeners.delete(table);
        }
      }
    };
  }

  // Notify all listeners for a table
  private notifyListeners(table: TableName, data: any[]): void {
    const tableListeners = this.listeners.get(table);
    if (tableListeners) {
      tableListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`[WS] Listener error for ${table}:`, error);
        }
      });
    }
  }

  // Check if connected
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const realtimeSocket = new RealtimeSocket();

// Hook helper - subscribe to table updates
export function onTableSync(table: TableName, callback: TableListener): () => void {
  return realtimeSocket.subscribe(table, callback);
}
