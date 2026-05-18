import { useState, useEffect, useCallback, useMemo } from 'react';
import { isDemoMode } from '@/lib/api/config';

export interface Notification {
  id: string;
  type: 'low_stock' | 'approval_pending' | 'payment_received' | 'stock_transfer' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  severity: 'info' | 'warning' | 'critical';
  link?: string;
}

const STORAGE_KEY = 'kwanza_notifications';
const MAX_NOTIFICATIONS = 50;

function loadNotifications(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: Notification[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifications);

  // Listen for notification events from other components
  useEffect(() => {
    const handler = (e: CustomEvent<Notification>) => {
      setNotifications(prev => {
        const updated = [e.detail, ...prev].slice(0, MAX_NOTIFICATIONS);
        saveNotifications(updated);
        return updated;
      });
    };
    window.addEventListener('kwanza-notification', handler as EventListener);
    return () => window.removeEventListener('kwanza-notification', handler as EventListener);
  }, []);

  // Check for low stock on interval (demo/localStorage only — avoid stale browser cache in Electron)
  useEffect(() => {
    if (!isDemoMode()) return;

    const checkLowStock = () => {
      try {
        const productsStr = localStorage.getItem('kwanzaerp_products');
        if (!productsStr) return;
        const products = JSON.parse(productsStr);
        const lowStockItems = products.filter((p: any) => 
          p.stock !== undefined && p.minStock !== undefined && p.stock <= p.minStock && p.stock >= 0
        );

        if (lowStockItems.length > 0) {
          const existingIds = new Set(notifications.filter(n => n.type === 'low_stock' && !n.read).map(n => n.id));
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

          if (newAlerts.length > 0) {
            setNotifications(prev => {
              const updated = [...newAlerts, ...prev].slice(0, MAX_NOTIFICATIONS);
              saveNotifications(updated);
              return updated;
            });
          }
        }
      } catch {
        // Ignore
      }
    };

    checkLowStock();
    const interval = setInterval(checkLowStock, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveNotifications([]);
  }, []);

  const addNotification = useCallback((notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotif: Notification = {
      ...notif,
      id: `${notif.type}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications(prev => {
      const updated = [newNotif, ...prev].slice(0, MAX_NOTIFICATIONS);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  return { notifications, unreadCount, markAsRead, markAllAsRead, clearAll, addNotification };
}

// Fire a notification from anywhere in the app
export function fireNotification(notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) {
  const detail: Notification = {
    ...notif,
    id: `${notif.type}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    read: false,
  };
  window.dispatchEvent(new CustomEvent('kwanza-notification', { detail }));
}
