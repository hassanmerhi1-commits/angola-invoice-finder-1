import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Send, RotateCcw, Radio, Copy, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';

type TransmissionRow = {
  id: string;
  transmission_type?: string;
  entity_type?: string;
  document_number?: string;
  invoice_number?: string;
  agt_status?: string;
  agt_code?: string;
  error_message?: string;
  retry_count?: number;
  transmitted_at?: string;
};

type StatusFilter = 'all' | 'failed' | 'pending';

type PortalPayload = {
  json?: string;
  simulated?: boolean;
  documentType?: string | null;
};

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to execCommand */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('copy failed');
}

export function AgtTransmissionsCard() {
  const { t, language } = useTranslation();
  const ui = t.agtTransmitUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { toast } = useToast();
  const [rows, setRows] = useState<TransmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [docQuery, setDocQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.agt.listTransmissions({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 200,
      });
      if (res.error) throw new Error(res.error);
      setRows(res.data || []);
      setListError(null);
    } catch (err) {
      setRows([]);
      setListError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t.common.loadFailed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyCopiedPayload = async (res: { error?: string; data?: PortalPayload }) => {
    if (res.error || !res.data?.json) {
      throw new Error(res.error || ui.copyJsonFailed);
    }
    await copyText(res.data.json);
    if (res.data.simulated) {
      toast({
        variant: 'destructive',
        title: ui.copyJson,
        description: ui.copyJsonSimulated,
      });
      return;
    }
    const type = res.data.documentType;
    toast({
      title: type
        ? ui.copyJsonSuccessType.replace('{type}', type)
        : ui.copyJsonSuccess,
    });
  };

  const handleCopyJson = async (id: string) => {
    setCopyingId(id);
    try {
      await applyCopiedPayload(await api.agt.getTransmissionPayload(id));
    } catch (err) {
      toast({
        variant: 'destructive',
        title: ui.copyJsonFailed,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCopyingId(null);
    }
  };

  const handleCopyByNumber = async () => {
    const q = docQuery.trim();
    if (!q) {
      toast({ variant: 'destructive', title: ui.copyJsonFailed, description: ui.copyByNumberEmpty });
      return;
    }
    const needle = q.toLowerCase();
    const match = rows.find((row) => {
      const n = String(row.document_number || row.invoice_number || '').toLowerCase();
      return n === needle || n.includes(needle);
    });
    setCopyingId(match?.id || `number:${q}`);
    try {
      if (match) {
        await applyCopiedPayload(await api.agt.getTransmissionPayload(match.id));
        return;
      }
      await applyCopiedPayload(await api.agt.getPortalPayload(q));
    } catch (err) {
      toast({
        variant: 'destructive',
        title: ui.copyJsonFailed,
        description: err instanceof Error ? err.message : ui.copyByNumberMissing,
      });
    } finally {
      setCopyingId(null);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      const res = await api.agt.retryTransmission(id);
      if (res.error) throw new Error(res.error);
      toast({ title: ui.retrySuccess });
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.retryFailed,
      });
    }
  };

  const handleRetryAllFailed = async () => {
    setBulkWorking(true);
    try {
      const res = await api.agt.retryFailedTransmissions(20);
      if (res.error) throw new Error(res.error);
      const retried = res.data?.retried ?? 0;
      toast({
        title: ui.retryAllSuccess.replace('{count}', String(retried)),
      });
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.retryFailed,
      });
    } finally {
      setBulkWorking(false);
    }
  };

  const handleReconcile = async () => {
    setBulkWorking(true);
    try {
      const res = await api.agt.reconcile(10);
      if (res.error) throw new Error(res.error);
      const d = res.data;
      const parts = [
        d?.failed?.retried ? ui.reconcileRetried.replace('{n}', String(d.failed.retried)) : '',
        d?.backfill?.transmitted ? ui.reconcileTransmitted.replace('{n}', String(d.backfill.transmitted)) : '',
        d?.pending?.updated ? ui.reconcileUpdated.replace('{n}', String(d.pending.updated)) : '',
      ].filter(Boolean);
      toast({
        title: ui.reconcileSuccess,
        description: parts.length ? parts.join(' · ') : ui.reconcileNothing,
      });
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.reconcileFailed,
      });
    } finally {
      setBulkWorking(false);
    }
  };

  const statusBadge = (status?: string) => {
    const s = String(status || 'pending').toLowerCase();
    if (s === 'validated' || s === 'approved') return <Badge>{ui.statusValidated}</Badge>;
    if (s === 'error' || s === 'rejected') return <Badge variant="destructive">{ui.statusError}</Badge>;
    if (s === 'invalid') return <Badge variant="destructive">{ui.statusInvalid}</Badge>;
    if (s === 'voided') return <Badge variant="secondary">{ui.statusVoided}</Badge>;
    return <Badge variant="outline">{ui.statusPending}</Badge>;
  };

  const typeLabel = (row: TransmissionRow) => {
    const key = row.entity_type || row.transmission_type || '';
    const map: Record<string, string> = {
      sale: ui.typeSale,
      invoice: ui.typeSale,
      credit_note: ui.typeCreditNote,
      debit_note: ui.typeDebitNote,
      void: ui.typeVoid,
    };
    return map[key] || key || '—';
  };

  const failedCount = rows.filter((r) => ['error', 'rejected', 'invalid'].includes(String(r.agt_status || '').toLowerCase())).length;

  const visibleRows = useMemo(() => {
    const q = docQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const n = String(row.document_number || row.invoice_number || '').toLowerCase();
      return n.includes(q);
    });
  }, [rows, docQuery]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {ui.title}
          </CardTitle>
          <CardDescription>{ui.description}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReconcile()}
            disabled={bulkWorking}
            className="gap-1"
          >
            <Radio className="h-3 w-3" />
            {ui.reconcileButton}
          </Button>
          {(statusFilter === 'failed' || failedCount > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRetryAllFailed()}
              disabled={bulkWorking}
              className="gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              {ui.retryAllButton}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading} className="gap-1">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t.common.refresh}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
          <p className="text-sm font-medium">{ui.copyJsonHint}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder={ui.searchDocPlaceholder}
              aria-label={ui.searchDoc}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCopyByNumber();
                }
              }}
            />
            <Button
              className="gap-1 shrink-0"
              disabled={copyingId != null}
              onClick={() => void handleCopyByNumber()}
            >
              {copyingId?.startsWith('number:') ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {ui.copyJson}
            </Button>
          </div>
        </div>

        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">{ui.filterAll}</TabsTrigger>
            <TabsTrigger value="failed">{ui.filterFailed}</TabsTrigger>
            <TabsTrigger value="pending">{ui.filterPending}</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : listError ? (
          <p className="text-sm text-destructive">{listError}</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{rows.length === 0 ? ui.empty : ui.copyByNumberMissing}</p>
        ) : (
          <div className="space-y-2">
            {visibleRows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-mono text-sm font-semibold">
                    {row.document_number || row.invoice_number || '—'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{typeLabel(row)}</span>
                    {statusBadge(row.agt_status)}
                    {row.agt_code ? <span className="font-mono">{row.agt_code}</span> : null}
                    <span>
                      {row.transmitted_at
                        ? new Date(row.transmitted_at).toLocaleString(locale)
                        : '—'}
                    </span>
                  </div>
                  {row.error_message ? (
                    <p className="text-xs text-destructive">{row.error_message}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={copyingId === row.id}
                    onClick={() => void handleCopyJson(row.id)}
                  >
                    {copyingId === row.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {ui.copyJson}
                  </Button>
                  {(row.agt_status === 'error' || row.agt_status === 'rejected') && (
                    <Button size="sm" variant="outline" onClick={() => void handleRetry(row.id)}>
                      {ui.retryButton}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
