import { useState, useMemo, useEffect, Fragment } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, Clock, AlertTriangle, AlertCircle, CheckCircle, Loader2, Wrench } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { isDemoMode } from '@/lib/api/config';
import { format, differenceInDays, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';
import { exportReportExcel } from '@/lib/reportExport';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';

interface AgingEntry {
  clientId: string;
  clientName: string;
  clientNif: string;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  total: number;
  invoices: {
    id: string;
    number: string;
    date: string;
    amount: number;
    daysOverdue: number;
  }[];
}

/** AR aging from open_items API (same source as Payments checklist). */
export default function AccountsReceivableReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId, dateTo, shared } = useSharedReportFilters();
  const asOf = shared ? dateTo : format(new Date(), 'yyyy-MM-dd');
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [lines, setLines] = useState<any[]>([]);

  const loadReceivables = async () => {
    setLoading(true);
    const res = await api.payments.receivablesAging(apiBranchId || undefined);
    setLines(Array.isArray(res.data) ? res.data : []);
    setLoading(false);
  };

  useEffect(() => {
    void loadReceivables();
  }, [apiBranchId]);

  const handleRepair = async () => {
    if (isDemoMode()) {
      toast({
        title: t.common.error,
        description:
          language === 'pt'
            ? 'Reparação só disponível com servidor ligado.'
            : 'Repair requires a connected server.',
        variant: 'destructive',
      });
      return;
    }
    setRepairing(true);
    try {
      const res = await api.payments.backfillMissingReceivables();
      if (res.error) throw new Error(res.error);
      await loadReceivables();
      toast({
        title: language === 'pt' ? 'Contas a receber actualizadas' : 'Accounts receivable updated',
        description:
          language === 'pt'
            ? 'Lista sincronizada com documentos em aberto.'
            : 'List synced with open customer documents.',
      });
    } catch (e) {
      toast({
        title: t.common.error,
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setRepairing(false);
    }
  };

  const agingReport = useMemo((): AgingEntry[] => {
    const asOfDate = parseISO(asOf);
    const byClient: Record<string, AgingEntry> = {};

    for (const row of lines) {
      const clientId = String(row.entity_id || '');
      if (!clientId) continue;
      const amount = Number(row.remaining_amount || 0);
      if (amount <= 0.001) continue;

      const docDate = String(row.document_date || '').slice(0, 10) || asOf;
      if (docDate > asOf) continue;

      if (!byClient[clientId]) {
        byClient[clientId] = {
          clientId,
          clientName: String(row.client_name || ''),
          clientNif: String(row.client_nif || ''),
          current: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          total: 0,
          invoices: [],
        };
      }

      const entry = byClient[clientId];
      const dueRaw = row.due_date || row.dueDate || docDate;
      const dueDate = String(dueRaw).slice(0, 10);
      const daysOverdue = Math.max(0, differenceInDays(asOfDate, parseISO(dueDate)));

      if (daysOverdue <= 30) entry.current += amount;
      else if (daysOverdue <= 60) entry.days30 += amount;
      else if (daysOverdue <= 90) entry.days60 += amount;
      else entry.days90 += amount;

      entry.total += amount;
      entry.invoices.push({
        id: String(row.id || row.document_id),
        number: String(row.document_number || ''),
        date: docDate,
        amount,
        daysOverdue,
      });
    }

    return Object.values(byClient)
      .filter((e) => e.total > 0.001)
      .sort((a, b) => b.total - a.total);
  }, [lines, asOf]);

  const summaryStats = useMemo(
    () =>
      agingReport.reduce(
        (acc, entry) => ({
          current: acc.current + entry.current,
          days30: acc.days30 + entry.days30,
          days60: acc.days60 + entry.days60,
          days90: acc.days90 + entry.days90,
          total: acc.total + entry.total,
        }),
        { current: 0, days30: 0, days60: 0, days90: 0, total: 0 },
      ),
    [agingReport],
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const getAgingBadge = (daysOverdue: number) => {
    if (daysOverdue <= 30) {
      return <Badge variant="secondary" className="bg-green-500/10 text-green-500">{t.reportsUi.current0to30}</Badge>;
    }
    if (daysOverdue <= 60) {
      return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500">{t.reportsUi.days31to60}</Badge>;
    }
    if (daysOverdue <= 90) {
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500">{t.reportsUi.days61to90}</Badge>;
    }
    return <Badge variant="destructive">{t.reportsUi.days90plus}</Badge>;
  };

  const handleExport = async () => {
    const data = agingReport.map((entry) => ({
      [t.reportsUi.client]: entry.clientName,
      [t.reportsUi.nif]: entry.clientNif,
      [t.reportsUi.current0to30]: entry.current,
      [t.reportsUi.days31to60]: entry.days30,
      [t.reportsUi.days61to90]: entry.days60,
      [t.reportsUi.days90plus]: entry.days90,
      [t.reportsUi.total]: entry.total,
    }));
    try {
      await exportReportExcel(data, `ContasReceber_Aging_${format(new Date(), 'yyyyMMdd')}`, {
        title: t.reportsUi.receivablesTitle,
      });
    } catch (e) {
      console.error('[AccountsReceivableReport] excel export failed:', e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>{t.common.loading}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.current0to30}</p>
            </div>
            <p className="text-2xl font-bold text-green-500">{formatCurrency(summaryStats.current)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-yellow-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.days31to60}</p>
            </div>
            <p className="text-2xl font-bold text-yellow-500">{formatCurrency(summaryStats.days30)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.days61to90}</p>
            </div>
            <p className="text-2xl font-bold text-orange-500">{formatCurrency(summaryStats.days60)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.days90plus}</p>
            </div>
            <p className="text-2xl font-bold text-red-500">{formatCurrency(summaryStats.days90)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">{t.reportsUi.totalToReceive}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                {t.reportsUi.receivablesTitle}
              </CardTitle>
              <CardDescription>
                {t.reportsUi.receivablesApiDesc} {t.reportsCenterUi.agingAsOfHint} {t.reportsCenterUi.asOfDate.replace('{date}', asOf)}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRepair} disabled={repairing}>
                {repairing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
                {t.reportsUi.repairReceivables}
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                {t.reportsUi.exportExcel}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reportsUi.client}</TableHead>
                <TableHead>{t.reportsUi.nif}</TableHead>
                <TableHead className="text-right text-green-500">{t.reportsUi.current0to30}</TableHead>
                <TableHead className="text-right text-yellow-500">{t.reportsUi.days31to60}</TableHead>
                <TableHead className="text-right text-orange-500">{t.reportsUi.days61to90}</TableHead>
                <TableHead className="text-right text-red-500">{t.reportsUi.days90plus}</TableHead>
                <TableHead className="text-right">{t.reportsUi.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingReport.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t.common.noResults}
                  </TableCell>
                </TableRow>
              ) : (
                agingReport.map((entry) => (
                  <Fragment key={entry.clientId}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        setExpandedClient(expandedClient === entry.clientId ? null : entry.clientId)
                      }
                    >
                      <TableCell className="font-medium">{entry.clientName}</TableCell>
                      <TableCell>{entry.clientNif}</TableCell>
                      <TableCell className="text-right">
                        {entry.current > 0 ? formatCurrency(entry.current) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.days30 > 0 ? formatCurrency(entry.days30) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.days60 > 0 ? formatCurrency(entry.days60) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.days90 > 0 ? formatCurrency(entry.days90) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(entry.total)}</TableCell>
                    </TableRow>
                    {expandedClient === entry.clientId && entry.invoices.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30 p-4">
                          <p className="text-sm font-medium mb-2">{t.reportsUi.openInvoices}</p>
                          <div className="space-y-2">
                            {entry.invoices.map((inv) => (
                              <div
                                key={inv.id}
                                className="flex items-center justify-between p-2 bg-background rounded"
                              >
                                <div className="flex items-center gap-4">
                                  <span className="font-mono text-sm">{inv.number}</span>
                                  <span className="text-sm text-muted-foreground">
                                    {format(parseISO(inv.date), 'dd/MM/yyyy', { locale: pt })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4">
                                  {getAgingBadge(inv.daysOverdue)}
                                  <span className="font-medium">{formatCurrency(inv.amount)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
