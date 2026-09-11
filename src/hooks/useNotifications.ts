import { useState, useEffect, useCallback, useMemo } from 'react';
import { isDemoMode } from '@/lib/api/config';
import { api } from '@/lib/api/client';
import { onTableSync } from '@/lib/realtime/socket';

export interface Notification {
  id: string;
  type: 'low_stock' | 'approval_pending' | 'approval_result' | 'payment_received' | 'stock_transfer' | 'system' | 'agt_failure' | 'overdue_ar' | 'period_close';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  severity: 'info' | 'warning' | 'critical';
  link?: string;
}

const STORAGE_KEY = 'kwanza_notifications';
const MAX_NOTIFICATIONS = 50;

/** Low stock lives in the daily checklist now; drop any still sitting in the cache. */
const RETIRED_TYPES = new Set<string>(['low_stock']);

function isRetired(n: Notification): boolean {
  return RETIRED_TYPES.has(n.type);
}

function loadLocalNotifications(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed: Notification[] = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => !isRetired(n)) : [];
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
    if (isRetired(n)) continue;
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

  // An approval waiting on someone is useless a minute late, so the poll above is only
  // the fallback for when the socket is down.
  useEffect(() => {
    if (isDemoMode()) return;
    return onTableSync('notifications', () => {
      void refreshFromServer();
    });
  }, [refreshFromServer]);

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

  // Clearing only the local cache made everything reappear on the next server refresh.
  const clearAll = useCallback(() => {
    setNotifications([]);
    saveLocalNotifications([]);
    if (!isDemoMode()) {
      void api.notifications.dismiss(undefined, true);
    }
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

  const scanAll = useCallback(async () => {
    if (isDemoMode()) return { total: 0 };
    const res = await api.notifications.scanAll();
    if (res.error) throw new Error(res.error);
    await refreshFromServer();
    return res.data || { total: 0 };
  }, [refreshFromServer]);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAll,
    addNotification,
    refreshFromServer,
    scanAll,
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
