import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { getOfflinePendingCount } from '@/lib/sync/offlineSales';
import { getLocalPendingSyncItems, isOfflineFirstEnabled } from '@/lib/sync/offlineFirst';
import { isThinClientMode } from '@/lib/api/config';

export function ClientSyncSettingsCard() {
  const { t } = useTranslation();
  const ui = t.clientSyncUi;
  const [offlineFirst, setOfflineFirst] = useState(false);
  const [thinClient, setThinClient] = useState(false);
  const [pending, setPending] = useState(0);
  const [agtPending, setAgtPending] = useState(0);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [flushing, setFlushing] = useState(false);

  const refresh = useCallback(async () => {
    setOfflineFirst(await isOfflineFirstEnabled());
    setThinClient(isThinClientMode());
    setPending(await getOfflinePendingCount());
    setItems(await getLocalPendingSyncItems());
    try {
      const agtApi = (window as any).electronAPI?.clientLocal?.getAgtPendingCount;
      if (agtApi) {
        const r = await agtApi();
        setAgtPending(Number(r?.count ?? 0));
      }
    } catch {
      setAgtPending(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const showCard = offlineFirst || (thinClient && pending > 0);
  if (!showCard) return null;

  const handleFlush = async () => {
    const api = (window as any).electronAPI?.syncOutbox;
    if (!api?.flush) return;
    setFlushing(true);
    try {
      await api.flush();
      await refresh();
    } finally {
      setFlushing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CloudOff className="h-4 w-4" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{ui.pendingLabel}</span>
          <Badge variant={pending > 0 ? 'destructive' : 'secondary'}>{pending}</Badge>
        </div>
        {offlineFirst && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{ui.agtPendingLabel}</span>
            <Badge variant={agtPending > 0 ? 'outline' : 'secondary'}>{agtPending}</Badge>
          </div>
        )}
        {offlineFirst && items.length > 0 && (
          <ul className="text-xs space-y-1 max-h-32 overflow-y-auto text-muted-foreground">
            {items.slice(0, 8).map((row) => (
              <li key={String(row.id)} className="flex justify-between gap-2">
                <span>{String(row.event_type || 'sale')}</span>
                <span>{String(row.status)}</span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="gap-2" onClick={handleFlush} disabled={flushing || pending === 0}>
          <RefreshCw className={`h-3.5 w-3.5 ${flushing ? 'animate-spin' : ''}`} />
          {ui.syncNow}
        </Button>
      </CardContent>
    </Card>
  );
}
