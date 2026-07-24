import { useState, useEffect, useCallback, useMemo } from 'react';
import { isDemoMode } from '@/lib/api/config';
import { api } from '@/lib/api/client';

export interface Notification {
  id: string;
  type: 'low_stock' | 'approval_pending' | 'payment_received' | 'stock_transfer' | 'system' | 'agt_failure' | 'overdue_ar' | 'period_close';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  severity: 'info' | 'warning' | 'critical';
  link?: string;
}

const STORAGE_KEY = 'kwanza_notifications';
const MAX_NOTIFICATIONS = 50;

function loadLocalNotifications(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLocalNotifications(notifications: Notification[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
}

function mapServerRow(row: Record<string, unknown>): Notification {
  return {
    id: String(row.id),
    type: (row.type as Notification['type']) || 'system',
    title: String(row.title || 'Notification'),
    message: String(row.message || ''),
    timestamp: String(row.timestamp || row.created_at || new Date().toISOString()),
    read: row.read === true || row.is_read === true || row.is_read === 1,
    severity: (row.severity as Notification['severity']) || 'info',
    link: row.link ? String(row.link) : undefined,
  };
}

function mergeById(primary: Notification[], secondary: Notification[]): Notification[] {
  const map = new Map<string, Notification>();
  for (const n of [...primary, ...secondary]) {
    if (!map.has(n.id)) map.set(n.id, n);
  }
  return [...map.values()]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, MAX_NOTIFICATIONS);
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(loadLocalNotifications);

  useEffect(() => {
    const handler = (e: CustomEvent<Notification>) => {
      setNotifications((prev) => {
        const updated = [e.detail, ...prev].slice(0, MAX_NOTIFICATIONS);
        saveLocalNotifications(updated);
        return updated;
      });
    };
    window.addEventListener('kwanza-notification', handler as EventListener);
    return () => window.removeEventListener('kwanza-notification', handler as EventListener);
  }, []);

  const refreshFromServer = useCallback(async () => {
    if (isDemoMode()) return;
    const token = localStorage.getItem('kwanza_auth_token');
    if (!token) return;
    try {
      const res = await api.notifications.list(50);
      if (res.error || !Array.isArray(res.data)) return;
      const serverRows = res.data.map((r) => mapServerRow(r as Record<string, unknown>));
      setNotifications((prev) => {
        const localOnly = prev.filter((n) => n.id.startsWith('low_stock_') || n.id.includes('_'));
        // Keep ephemeral local events that are not server UUIDs.
        const ephemeral = localOnly.filter((n) => !/^[0-9a-f-]{36}$/i.test(n.id));
        const merged = mergeById(serverRows, ephemeral);
        saveLocalNotifications(merged);
        return merged;
      });
    } catch {
      // Keep local cache when API unreachable
    }
  }, []);

  useEffect(() => {
    void refreshFromServer();
    if (isDemoMode()) return;
    const interval = setInterval(() => void refreshFromServer(), 60_000);
    return () => clearInterval(interval);
  }, [refreshFromServer]);

  // Demo/localStorage-only low-stock scan
  useEffect(() => {
    if (!isDemoMode()) return;

    const checkLowStock = () => {
      try {
        const productsStr = localStorage.getItem('kwanzaerp_products');
        if (!productsStr) return;
        const products = JSON.parse(productsStr);
        const lowStockItems = products.filter((p: { stock?: number; minStock?: number }) =>
          p.stock !== undefined && p.minStock !== undefined && p.stock <= p.minStock && p.stock >= 0,
        );

        if (lowStockItems.length > 0) {
          setNotifications((prev) => {
            const existingIds = new Set(prev.filter((n) => n.type === 'low_stock' && !n.read).map((n) => n.id));
            const newAlerts: Notification[] = [];
            for (const item of lowStockItems) {
              const alertId = `low_stock_${item.id}_${new Date().toDateString()}`;
              if (!existingIds.has(alertId)) {
                newAlerts.push({
                  id: alertId,
                  type: 'low_stock',
                  title: 'Stock Baixo',
                  message: `${item.name}: ${item.stock} unidades (mín: ${item.minStock})`,
                  timestamp: new Date().toISOString(),
                  read: false,
                  severity: item.stock === 0 ? 'critical' : 'warning',
                  link: '/inventory',
                });
              }
            }
            if (newAlerts.length === 0) return prev;
            const updated = [...newAlerts, ...prev].slice(0, MAX_NOTIFICATIONS);
            saveLocalNotifications(updated);
            return updated;
          });
        }
      } catch {
        // Ignore
      }
    };

    checkLowStock();
    const interval = setInterval(checkLowStock, 60_000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveLocalNotifications(updated);
      return updated;
    });
    if (!isDemoMode() && /^[0-9a-f-]{36}$/i.test(id)) {
      void api.notifications.markRead([id]);
    }
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveLocalNotifications(updated);
      return updated;
    });
    if (!isDemoMode()) {
      void api.notifications.markRead(undefined, true);
    }
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveLocalNotifications([]);
  }, []);

  const addNotification = useCallback((notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotif: Notification = {
      ...notif,
      id: `${notif.type}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications((prev) => {
      const updated = [newNotif, ...prev].slice(0, MAX_NOTIFICATIONS);
      saveLocalNotifications(updated);
      return updated;
    });
  }, []);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAll,
    addNotification,
    refreshFromServer,
  };
}

export function fireNotification(notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) {
  const detail: Notification = {
    ...notif,
    id: `${notif.type}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    read: false,
  };
  window.dispatchEvent(new CustomEvent('kwanza-notification', { detail }));
}
