import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Clock, AlertTriangle, AlertCircle, CheckCircle, Loader2, Wrench } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { isDemoMode } from '@/lib/api/config';
import { format, differenceInDays, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';
import { exportReportExcel } from '@/lib/reportExport';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';

interface PayableEntry {
  supplierId: string;
  supplierName: string;
  supplierNif: string;
  paymentTerms: string;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  total: number;
  lines: {
    id: string;
    documentNumber: string;
    documentDate: string;
    dueDate: string;
    amount: number;
    daysUntilDue: number;
  }[];
}

function getPaymentTermDays(terms: string): number {
  switch (terms) {
    case 'immediate': return 0;
    case '15_days': return 15;
    case '30_days': return 30;
    case '60_days': return 60;
    case '90_days': return 90;
    default: return 30;
  }
}

export default function AccountsPayableReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [payableLines, setPayableLines] = useState<any[]>([]);

  const loadPayables = async () => {
    setLoading(true);
    const res = await api.payments.payablesAging();
    setPayableLines(Array.isArray(res.data) ? res.data : []);
    setLoading(false);
  };

  useEffect(() => {
    void loadPayables();
  }, []);

  const handleRepairPayables = async () => {
    if (isDemoMode()) {
      toast({
        title: t.common.error,
        description: language === 'pt' ? 'Reparação só disponível com servidor ligado.' : 'Repair requires a connected server.',
        variant: 'destructive',
      });
      return;
    }
    setRepairing(true);
    try {
      const res = await api.payments.repairSupplierPayables();
      if (res.error) throw new Error(res.error);
      const created = res.data?.backfill?.created ?? 0;
      await loadPayables();
      toast({
        title: language === 'pt' ? 'Contas a pagar actualizadas' : 'Accounts payable updated',
        description:
          language === 'pt'
            ? created > 0
              ? `${created} documento(s) de compra ligado(s) a contas a pagar.`
              : 'Nenhum documento em falta encontrado; lista actualizada.'
            : created > 0
              ? `Linked ${created} purchase invoice(s) to payables.`
              : 'No missing documents found; list refreshed.',
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

  const payableReport = useMemo((): PayableEntry[] => {
    const today = new Date();
    const bySupplier: Record<string, PayableEntry> = {};

    for (const row of payableLines) {
      const supplierId = String(row.entity_id || '');
      if (!supplierId) continue;

      const amount = Number(row.remaining_amount || 0);
      if (amount <= 0.001) continue;

      if (!bySupplier[supplierId]) {
        bySupplier[supplierId] = {
          supplierId,
          supplierName: String(row.supplier_name || ''),
          supplierNif: String(row.supplier_nif || ''),
          paymentTerms: String(row.payment_terms || '30_days'),
          current: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          total: 0,
          lines: [],
        };
      }

      const entry = bySupplier[supplierId];
      const docDate = String(row.document_date || '').slice(0, 10) || format(today, 'yyyy-MM-dd');
      const dueRaw = row.due_date || row.dueDate;
      const dueDate = dueRaw
        ? String(dueRaw).slice(0, 10)
        : format(
            new Date(docDate).getTime() + getPaymentTermDays(entry.paymentTerms) * 86400000,
            'yyyy-MM-dd',
          );
      const daysUntilDue = differenceInDays(parseISO(dueDate), today);

      if (daysUntilDue >= 0) entry.current += amount;
      else if (daysUntilDue >= -30) entry.days30 += amount;
      else if (daysUntilDue >= -60) entry.days60 += amount;
      else entry.days90 += amount;

      entry.total += amount;
      entry.lines.push({
        id: String(row.id || row.document_id),
        documentNumber: String(row.document_number || ''),
        documentDate: docDate,
        dueDate,
        amount,
        daysUntilDue,
      });
    }

    return Object.values(bySupplier)
      .filter((e) => e.total > 0.001)
      .sort((a, b) => b.total - a.total);
  }, [payableLines]);

  const summaryStats = useMemo(() => {
    return payableReport.reduce(
      (acc, entry) => ({
        current: acc.current + entry.current,
        days30: acc.days30 + entry.days30,
        days60: acc.days60 + entry.days60,
        days90: acc.days90 + entry.days90,
        total: acc.total + entry.total,
      }),
      { current: 0, days30: 0, days60: 0, days90: 0, total: 0 },
    );
  }, [payableReport]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'AOA',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const getDueBadge = (daysUntilDue: number) => {
    if (daysUntilDue >= 7) {
      return <Badge variant="secondary" className="bg-green-500/10 text-green-500">{t.reportsUi.dueSoon}</Badge>;
    }
    if (daysUntilDue >= 0) {
      return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500">{t.reportsUi.dueShort}</Badge>;
    }
    if (daysUntilDue >= -30) {
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500">{t.reportsUi.overdue}</Badge>;
    }
    return <Badge variant="destructive">{t.reportsUi.veryLate}</Badge>;
  };

  const handleExport = async () => {
    const data = payableReport.map((entry) => ({
      [t.reportsUi.supplier]: entry.supplierName,
      [t.reportsUi.nif]: entry.supplierNif,
      [t.reportsUi.paymentTerm]: entry.paymentTerms.replace('_', ' '),
      [t.reportsUi.currentDue]: entry.current,
      [t.reportsUi.overdue1to30]: entry.days30,
      [t.reportsUi.overdue31to60]: entry.days60,
      [t.reportsUi.overdue60plus]: entry.days90,
      [t.reportsUi.total]: entry.total,
    }));
    try {
      await exportReportExcel(data, `ContasPagar_${format(new Date(), 'yyyyMMdd')}`, {
        title: t.reportsUi.payablesTitle,
      });
    } catch (e) {
      console.error('[AccountsPayableReport] excel export failed:', e);
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
              <p className="text-sm text-muted-foreground">{t.reportsUi.dueSoon}</p>
            </div>
            <p className="text-2xl font-bold text-green-500">{formatCurrency(summaryStats.current)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-yellow-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.overdue1to30}</p>
            </div>
            <p className="text-2xl font-bold text-yellow-500">{formatCurrency(summaryStats.days30)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.overdue31to60}</p>
            </div>
            <p className="text-2xl font-bold text-orange-500">{formatCurrency(summaryStats.days60)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-sm text-muted-foreground">{t.reportsUi.overdue60plus}</p>
            </div>
            <p className="text-2xl font-bold text-red-500">{formatCurrency(summaryStats.days90)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">{t.reportsUi.totalToPay}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {t.reportsUi.payablesTitle}
              </CardTitle>
              <CardDescription>{t.reportsUi.payablesDesc}</CardDescription>
            </div>
            <Button variant="outline" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              {t.reportsUi.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reportsUi.supplier}</TableHead>
                <TableHead>{t.reportsUi.nif}</TableHead>
                <TableHead>{t.reportsUi.paymentTerm}</TableHead>
                <TableHead className="text-right text-green-500">{t.reportsUi.currentDue}</TableHead>
                <TableHead className="text-right text-yellow-500">{t.reportsUi.overdue1to30}</TableHead>
                <TableHead className="text-right text-orange-500">{t.reportsUi.overdue31to60}</TableHead>
                <TableHead className="text-right text-red-500">{t.reportsUi.overdue60plus}</TableHead>
                <TableHead className="text-right">{t.reportsUi.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payableReport.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <p className="text-muted-foreground mb-3">
                      {language === 'pt'
                        ? 'Nenhuma dívida em aberto a fornecedores. Se existem facturas de compra confirmadas, pode sincronizar contas a pagar.'
                        : 'No open supplier payables. If you have confirmed purchase invoices, you can sync payables from them.'}
                    </p>
                    {!isDemoMode() && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={repairing || loading}
                        onClick={() => void handleRepairPayables()}
                      >
                        {repairing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Wrench className="h-4 w-4" />
                        )}
                        {language === 'pt' ? 'Sincronizar de facturas de compra' : 'Sync from purchase invoices'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                payableReport.map((entry) => (
                  <TableRow
                    key={entry.supplierId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() =>
                      setExpandedSupplier(expandedSupplier === entry.supplierId ? null : entry.supplierId)
                    }
                  >
                    <TableCell className="font-medium">{entry.supplierName}</TableCell>
                    <TableCell>{entry.supplierNif}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.paymentTerms.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.current > 0 ? formatCurrency(entry.current) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.days30 > 0 ? formatCurrency(entry.days30) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.days60 > 0 ? formatCurrency(entry.days60) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.days90 > 0 ? formatCurrency(entry.days90) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(entry.total)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {expandedSupplier && payableReport.find((e) => e.supplierId === expandedSupplier)?.lines.length ? (
            <div className="mt-4 p-4 bg-muted/30 rounded-lg space-y-2">
              <p className="text-sm font-medium">{t.paymentsUi.openDocsToOffset}</p>
              {payableReport
                .find((e) => e.supplierId === expandedSupplier)!
                .lines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between p-2 bg-background rounded text-sm">
                    <span className="font-mono">{line.documentNumber}</span>
                    <span className="text-muted-foreground">
                      {format(parseISO(line.dueDate), 'dd/MM/yyyy', { locale: pt })}
                    </span>
                    {getDueBadge(line.daysUntilDue)}
                    <span className="font-medium">{formatCurrency(line.amount)}</span>
                  </div>
                ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
