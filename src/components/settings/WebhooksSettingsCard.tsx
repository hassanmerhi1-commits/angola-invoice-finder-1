import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, RotateCcw, Send, Trash2, Webhook } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { api } from '@/lib/api/client';

type WebhookRow = {
  id: string;
  name: string;
  url: string;
  events?: string[] | string;
  isActive?: boolean;
  is_active?: boolean | number;
};

type DeliveryRow = {
  id: string;
  webhookId: string;
  webhookName: string;
  webhookUrl: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

const DEFAULT_EVENTS = 'sale.created';

const KNOWN_EVENTS = [
  'sale.created',
  'payment.created',
  'purchase_invoice.created',
  'sales_order.reserved',
  'sales_order.cancelled',
  'stock_transfer.approved',
  'stock_transfer.received',
  '*',
] as const;

function deliveryBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'delivered') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'pending') return 'secondary';
  return 'outline';
}

export function WebhooksSettingsCard() {
  const { user } = useAuth();
  const { isAdmin, hasPermission } = usePermissions(user?.id);
  const canManage = isAdmin || hasPermission('admin_settings');

  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(DEFAULT_EVENTS);
  const [secret, setSecret] = useState('');

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const [whRes, delRes] = await Promise.all([
        api.webhooks.list(),
        api.webhooks.listDeliveries({ limit: 40 }),
      ]);
      if (whRes.error) throw new Error(whRes.error);
      if (delRes.error) throw new Error(delRes.error);
      setRows(Array.isArray(whRes.data) ? whRes.data : []);
      setDeliveries(Array.isArray(delRes.data) ? delRes.data : []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManage) return null;

  const create = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    setSaving(true);
    try {
      const eventList = events.split(',').map((e) => e.trim()).filter(Boolean);
      const res = await api.webhooks.create({
        name: name.trim(),
        url: url.trim(),
        events: eventList,
        secret: secret.trim() || undefined,
        isActive: true,
      });
      if (res.error) throw new Error(res.error);
      toast.success('Webhook created');
      setName('');
      setUrl('');
      setSecret('');
      setEvents(DEFAULT_EVENTS);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await api.webhooks.remove(id);
      if (res.error) throw new Error(res.error);
      toast.success('Webhook removed');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove webhook');
    } finally {
      setSaving(false);
    }
  };

  const retry = async (id: string) => {
    setSaving(true);
    try {
      const res = await api.webhooks.retryDelivery(id);
      if (res.error) throw new Error(res.error);
      toast.success('Delivery re-queued');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to retry delivery');
    } finally {
      setSaving(false);
    }
  };

  const testPing = async (id: string) => {
    setSaving(true);
    try {
      const res = await api.webhooks.test(id);
      if (res.error) throw new Error(res.error);
      const status = res.data?.status || 'pending';
      if (status === 'delivered') {
        toast.success('Test webhook delivered');
      } else {
        toast.error(res.data?.lastError || `Test status: ${status}`);
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to test webhook');
    } finally {
      setSaving(false);
    }
  };

  const eventsLabel = (row: WebhookRow) => {
    if (Array.isArray(row.events)) return row.events.join(', ');
    if (typeof row.events === 'string') {
      try {
        const parsed = JSON.parse(row.events);
        return Array.isArray(parsed) ? parsed.join(', ') : row.events;
      } catch {
        return row.events;
      }
    }
    return '—';
  };

  const selectedEvents = useMemo(
    () => new Set(events.split(',').map((e) => e.trim()).filter(Boolean)),
    [events],
  );

  const toggleEvent = (eventName: string) => {
    const next = new Set(selectedEvents);
    if (next.has(eventName)) next.delete(eventName);
    else next.add(eventName);
    setEvents([...next].join(', '));
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhooks
          </CardTitle>
          <CardDescription>
            Outbound events: sale.created, payment.created, purchase_invoice.created,
            sales_order.reserved/cancelled, stock_transfer.approved/received.
            Deliveries are queued and retried by the worker.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Accounting sync" />
          </div>
          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/nexor" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Events</Label>
            <div className="flex flex-wrap gap-2">
              {KNOWN_EVENTS.map((ev) => {
                const on = selectedEvents.has(ev);
                return (
                  <Button
                    key={ev}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    className="h-7 text-xs font-mono"
                    onClick={() => toggleEvent(ev)}
                  >
                    {ev}
                  </Button>
                );
              })}
            </div>
            <Input
              value={events}
              onChange={(e) => setEvents(e.target.value)}
              placeholder={DEFAULT_EVENTS}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Secret (optional)</Label>
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="HMAC secret" />
          </div>
        </div>
        <Button onClick={() => void create()} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add webhook
        </Button>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No webhooks configured.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const active = row.isActive === true || row.is_active === true || row.is_active === 1;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm">{row.url}</TableCell>
                    <TableCell className="text-sm">{eventsLabel(row)}</TableCell>
                    <TableCell>
                      <Badge variant={active ? 'default' : 'secondary'}>
                        {active ? 'Active' : 'Off'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={saving}
                        title="Send test ping"
                        onClick={() => void testPing(row.id)}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={saving}
                        onClick={() => void remove(row.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="pt-2 border-t space-y-2">
          <h3 className="text-sm font-medium">Recent deliveries</h3>
          {!loading && deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deliveries yet.</p>
          ) : deliveries.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Webhook</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Retry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate">
                      {d.webhookName || d.webhookId}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{d.eventType}</TableCell>
                    <TableCell>
                      <Badge variant={deliveryBadgeVariant(d.status)}>
                        {d.status}
                        {d.attempts > 0 ? ` ×${d.attempts}` : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {d.lastError || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {d.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={saving}
                          onClick={() => void retry(d.id)}
                          title="Re-queue"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
