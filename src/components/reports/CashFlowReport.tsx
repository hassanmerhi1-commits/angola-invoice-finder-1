import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales } from '@/hooks/useERP';
import { Download, ArrowUpCircle, ArrowDownCircle, Wallet, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from 'date-fns';
import { exportToExcel } from '@/lib/excel';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function CashFlowReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await api.purchaseInvoices.list(apiBranchId ? { branchId: apiBranchId } : undefined);
      if (!cancelled) {
        setPurchases(Array.isArray(res.data) ? res.data : []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBranchId]);

  const localDate = (raw?: string) => (raw ? String(raw).slice(0, 10) : '');
  const inRange = (raw?: string) => {
    const d = localDate(raw);
    return !!d && d >= dateFrom && d <= dateTo;
  };

  const inflowByMethod = useMemo(() => {
    const acc = { cash: 0, card: 0, transfer: 0, mixed: 0, total: 0 };
    sales
      .filter((s) => s.status === 'completed' && inRange(s.createdAt))
      .forEach((s) => {
        const v = Number(s.total || 0);
        const m = (s.paymentMethod || 'cash') as keyof typeof acc;
        if (m in acc) acc[m] += v;
        else acc.cash += v;
        acc.total += v;
      });
    return acc;
  }, [sales, dateFrom, dateTo]);

  const outflowTotal = useMemo(() => {
    return purchases
      .filter((p) => String(p.status || '') !== 'draft' && inRange(p.date || p.createdAt))
      .reduce((sum, p) => sum + Number(p.total || 0), 0);
  }, [purchases, dateFrom, dateTo]);

  const netFlow = inflowByMethod.total - outflowTotal;

  const daily = useMemo(() => {
    let days: Date[] = [];
    try {
      days = eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) });
    } catch {
      days = [];
    }
    // Cap to keep chart readable
    const limited = days.length > 92 ? days.slice(days.length - 92) : days;
    return limited.map((d) => {
      const key = format(d, 'yyyy-MM-dd');
      const inflow = sales
        .filter((s) => s.status === 'completed' && localDate(s.createdAt) === key)
        .reduce((sum, s) => sum + Number(s.total || 0), 0);
      const outflow = purchases
        .filter((p) => String(p.status || '') !== 'draft' && localDate(p.date || p.createdAt) === key)
        .reduce((sum, p) => sum + Number(p.total || 0), 0);
      return { label: format(d, 'dd/MM'), inflow, outflow, net: inflow - outflow };
    });
  }, [sales, purchases, dateFrom, dateTo]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const handleExport = () => {
    const rows = daily.map((d) => ({
      [t.cashFlowUi.day]: d.label,
      [t.cashFlowUi.inflow]: d.inflow,
      [t.cashFlowUi.outflow]: d.outflow,
      [t.cashFlowUi.net]: d.net,
    }));
    exportToExcel(rows, `CashFlow_${dateFrom}_${dateTo}`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                {t.cashFlowUi.title}
              </CardTitle>
              <CardDescription>{t.cashFlowUi.description}</CardDescription>
            </div>
            <Button variant="outline" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              {t.reportsUi.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>{t.reportsUi.dateFrom}</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label>{t.reportsUi.dateTo}</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t.common.loading}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowUpCircle className="w-4 h-4 text-green-500" />
                  <p className="text-sm text-muted-foreground">{t.cashFlowUi.inflow}</p>
                </div>
                <p className="text-2xl font-bold text-green-500">{formatCurrency(inflowByMethod.total)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDownCircle className="w-4 h-4 text-red-500" />
                  <p className="text-sm text-muted-foreground">{t.cashFlowUi.outflow}</p>
                </div>
                <p className="text-2xl font-bold text-red-500">{formatCurrency(outflowTotal)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4" />
                  <p className="text-sm text-muted-foreground">{t.cashFlowUi.net}</p>
                </div>
                <p className={`text-2xl font-bold ${netFlow >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatCurrency(netFlow)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t.cashFlowUi.inflowByMethod}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-green-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodCash}</p>
                  <p className="text-xl font-bold text-green-500">{formatCurrency(inflowByMethod.cash)}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodCard}</p>
                  <p className="text-xl font-bold text-blue-500">{formatCurrency(inflowByMethod.card)}</p>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodTransfer}</p>
                  <p className="text-xl font-bold text-purple-500">{formatCurrency(inflowByMethod.transfer)}</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.cashFlowUi.mixed}</p>
                  <p className="text-xl font-bold">{formatCurrency(inflowByMethod.mixed)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.cashFlowUi.dailyTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Bar dataKey="inflow" name={t.cashFlowUi.inflow} fill="#10b981" />
                    <Bar dataKey="outflow" name={t.cashFlowUi.outflow} fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
