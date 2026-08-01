import { Bell, Package, CheckCircle, CreditCard, ArrowRightLeft, Info, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';

const iconMap: Record<string, React.ReactNode> = {
  low_stock: <Package className="w-4 h-4 text-orange-500" />,
  overdue_ar: <CreditCard className="w-4 h-4 text-orange-500" />,
  period_close: <Info className="w-4 h-4 text-blue-500" />,
  agt_failure: <Info className="w-4 h-4 text-destructive" />,
  approval_pending: <CheckCircle className="w-4 h-4 text-blue-500" />,
  payment_received: <CreditCard className="w-4 h-4 text-emerald-500" />,
  stock_transfer: <ArrowRightLeft className="w-4 h-4 text-purple-500" />,
  system: <Info className="w-4 h-4 text-muted-foreground" />,
};

const severityDot: Record<Notification['severity'], string> = {
  info: 'bg-blue-500',
  warning: 'bg-orange-500',
  critical: 'bg-destructive',
};

export function NotificationBell() {
  const { t, language } = useTranslation();
  const dfLocale = language === 'pt' ? pt : enUS;
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll, scanAll, refreshFromServer } = useNotifications();
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);

  const handleClick = (notif: Notification) => {
    markAsRead(notif.id);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const r = await scanAll();
      await refreshFromServer();
      // silent if zero; toast via console for admins
      if ((r as any)?.total > 0) {
        console.log('[NOTIFICATIONS] scan created', r);
      }
    } catch (e) {
      console.warn('[NOTIFICATIONS] scan failed', e);
    } finally {
      setScanning(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">{t.notificationsUi.title}</h4>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              disabled={scanning}
              onClick={() => void handleScan()}
              title={t.notificationsUi.scanTitle}
            >
              {scanning ? '…' : 'Scan'}
            </Button>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllAsRead}>
                {t.notificationsUi.markAllRead}
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" onClick={clearAll}>
                {t.notificationsUi.clear}
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {t.notificationsUi.empty}
            </div>
          ) : (
            <div>
              {notifications.slice(0, 20).map((notif, i) => (
                <div key={notif.id}>
                  <button
                    onClick={() => handleClick(notif)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                      !notif.read ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{iconMap[notif.type] || iconMap.system}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{notif.title}</span>
                          {!notif.read && (
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityDot[notif.severity]}`} />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notif.timestamp), { addSuffix: true, locale: dfLocale })}
                        </p>
                      </div>
                    </div>
                  </button>
                  {i < notifications.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
