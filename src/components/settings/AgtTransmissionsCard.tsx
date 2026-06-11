import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  transmitted_at?: string;
};

export function AgtTransmissionsCard() {
  const { t, language } = useTranslation();
  const ui = t.agtTransmitUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { toast } = useToast();
  const [rows, setRows] = useState<TransmissionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.agt.listTransmissions({ limit: 30 });
      setRows(res.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const statusBadge = (status?: string) => {
    const s = String(status || 'pending').toLowerCase();
    if (s === 'validated' || s === 'approved') return <Badge>{ui.statusValidated}</Badge>;
    if (s === 'error' || s === 'rejected') return <Badge variant="destructive">{ui.statusError}</Badge>;
    return <Badge variant="outline">{ui.statusPending}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {ui.title}
          </CardTitle>
          <CardDescription>{ui.description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-1">
          <RefreshCw className="h-3 w-3" />
          {t.common.refresh}
        </Button>
      </CardHeader>
      <CardContent>
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
                  <TableCell>{row.entity_type || row.transmission_type}</TableCell>
                  <TableCell>{statusBadge(row.agt_status)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.agt_code || '—'}</TableCell>
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
