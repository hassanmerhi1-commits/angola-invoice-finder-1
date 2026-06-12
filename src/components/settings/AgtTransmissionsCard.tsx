import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send, RotateCcw, Radio } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

export function AgtTransmissionsCard() {
  const { t, language } = useTranslation();
  const ui = t.agtTransmitUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { toast } = useToast();
  const [rows, setRows] = useState<TransmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [bulkWorking, setBulkWorking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.agt.listTransmissions({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 50,
      });
      setRows(res.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const failedCount = rows.filter((r) => ['error', 'rejected'].includes(String(r.agt_status || '').toLowerCase())).length;

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
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">{ui.filterAll}</TabsTrigger>
            <TabsTrigger value="failed">{ui.filterFailed}</TabsTrigger>
            <TabsTrigger value="pending">{ui.filterPending}</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ui.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ui.colDocument}</TableHead>
                <TableHead>{ui.colType}</TableHead>
                <TableHead>{ui.colStatus}</TableHead>
                <TableHead>{ui.colCode}</TableHead>
                <TableHead>{ui.colError}</TableHead>
                <TableHead>{ui.colDate}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    {row.document_number || row.invoice_number || '—'}
                  </TableCell>
                  <TableCell>{typeLabel(row)}</TableCell>
                  <TableCell>{statusBadge(row.agt_status)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.agt_code || '—'}</TableCell>
                  <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={row.error_message}>
                    {row.error_message || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.transmitted_at
                      ? new Date(row.transmitted_at).toLocaleString(locale)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {(row.agt_status === 'error' || row.agt_status === 'rejected') && (
                      <Button size="sm" variant="outline" onClick={() => void handleRetry(row.id)}>
                        {ui.retryButton}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
