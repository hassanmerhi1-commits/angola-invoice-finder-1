import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useSuppliers, usePurchaseOrders } from '@/hooks/useERP';
import { Download, FileText, Clock, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import { format, differenceInDays, parseISO, addDays } from 'date-fns';
import { pt } from 'date-fns/locale';
import { exportToExcel } from '@/lib/excel';
import { useTranslation } from '@/i18n';

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
  orders: {
    id: string;
    number: string;
    date: string;
    dueDate: string;
    amount: number;
    daysUntilDue: number;
  }[];
}

export default function AccountsPayableReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { suppliers } = useSuppliers();
  const { orders } = usePurchaseOrders();
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  const getPaymentTermDays = (terms: string): number => {
    switch (terms) {
      case 'immediate': return 0;
      case '15_days': return 15;
      case '30_days': return 30;
      case '60_days': return 60;
      case '90_days': return 90;
      default: return 30;
    }
  };

  const payableReport = useMemo((): PayableEntry[] => {
    const today = new Date();
    const supplierPayables: Record<string, PayableEntry> = {};
    
    // Get received purchase orders (we owe money for these)
    orders
      .filter(order => order.status === 'received' || order.status === 'partial')
      .forEach(order => {
        const supplier = suppliers.find(s => s.id === order.supplierId);
        if (!supplier) return;
        
        const supplierId = supplier.id;
        if (!supplierPayables[supplierId]) {
          supplierPayables[supplierId] = {
            supplierId,
            supplierName: supplier.name,
            supplierNif: supplier.nif,
            paymentTerms: supplier.paymentTerms,
            current: 0,
            days30: 0,
            days60: 0,
            days90: 0,
            total: 0,
            orders: [],
          };
        }
        
        const orderDate = parseISO(order.createdAt);
        const paymentTermDays = getPaymentTermDays(supplier.paymentTerms);
        const dueDate = addDays(orderDate, paymentTermDays);
        const daysUntilDue = differenceInDays(dueDate, today);
        const amount = order.total;
        
        // Add to appropriate bucket based on due date
        if (daysUntilDue >= 0) {
          // Not yet due
          supplierPayables[supplierId].current += amount;
        } else if (daysUntilDue >= -30) {
          // 1-30 days overdue
          supplierPayables[supplierId].days30 += amount;
        } else if (daysUntilDue >= -60) {
          // 31-60 days overdue
          supplierPayables[supplierId].days60 += amount;
        } else {
          // 60+ days overdue
          supplierPayables[supplierId].days90 += amount;
        }
        
        supplierPayables[supplierId].total += amount;
        supplierPayables[supplierId].orders.push({
          id: order.id,
          number: order.orderNumber,
          date: order.createdAt,
          dueDate: dueDate.toISOString(),
          amount,
          daysUntilDue,
        });
      });
    
    return Object.values(supplierPayables)
      .filter(entry => entry.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [suppliers, orders]);

  const summaryStats = useMemo(() => {
    return payableReport.reduce((acc, entry) => ({
      current: acc.current + entry.current,
      days30: acc.days30 + entry.days30,
      days60: acc.days60 + entry.days60,
      days90: acc.days90 + entry.days90,
      total: acc.total + entry.total,
    }), { current: 0, days30: 0, days60: 0, days90: 0, total: 0 });
  }, [payableReport]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency', 
      currency: 'AOA',
      minimumFractionDigits: 0 
    }).format(value);
  };

  const getDueBadge = (daysUntilDue: number) => {
    if (daysUntilDue >= 7) {
      return <Badge variant="secondary" className="bg-green-500/10 text-green-500">{t.reportsUi.dueSoon}</Badge>;
    } else if (daysUntilDue >= 0) {
      return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500">{t.reportsUi.dueShort}</Badge>;
    } else if (daysUntilDue >= -30) {
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500">{t.reportsUi.overdue}</Badge>;
    } else {
      return <Badge variant="destructive">{t.reportsUi.veryLate}</Badge>;
    }
  };

  const handleExport = () => {
    const data = payableReport.map(entry => ({
      [t.reportsUi.supplier]: entry.supplierName,
      [t.reportsUi.nif]: entry.supplierNif,
      [t.reportsUi.paymentTerm]: entry.paymentTerms.replace('_', ' '),
      [t.reportsUi.currentDue]: entry.current,
      [t.reportsUi.overdue1to30]: entry.days30,
      [t.reportsUi.overdue31to60]: entry.days60,
      [t.reportsUi.overdue60plus]: entry.days90,
      [t.reportsUi.total]: entry.total,
    }));
    
    exportToExcel(data, `ContasPagar_${format(new Date(), 'yyyyMMdd')}`);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
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

      {/* Payables Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {t.reportsUi.payablesTitle}
              </CardTitle>
              <CardDescription>
                {t.reportsUi.payablesDesc}
              </CardDescription>
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
                <TableHead>Fornecedor</TableHead>
                <TableHead>NIF</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead className="text-right text-green-500">A Vencer</TableHead>
                <TableHead className="text-right text-yellow-500">1-30 dias</TableHead>
                <TableHead className="text-right text-orange-500">31-60 dias</TableHead>
                <TableHead className="text-right text-red-500">+60 dias</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payableReport.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Nenhuma dívida a fornecedor encontrada
                  </TableCell>
                </TableRow>
              ) : (
                payableReport.map((entry) => (
                  <>
                    <TableRow 
                      key={entry.supplierId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedSupplier(
                        expandedSupplier === entry.supplierId ? null : entry.supplierId
                      )}
                    >
                      <TableCell className="font-medium">{entry.supplierName}</TableCell>
                      <TableCell>{entry.supplierNif}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.paymentTerms.replace('_', ' ')}</Badge>
                      </TableCell>
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
                    {expandedSupplier === entry.supplierId && entry.orders.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
                          <p className="text-sm font-medium mb-2">Ordens de Compra:</p>
                          <div className="space-y-2">
                            {entry.orders.map(order => (
                              <div key={order.id} className="flex items-center justify-between p-2 bg-background rounded">
                                <div className="flex items-center gap-4">
                                  <span className="font-mono text-sm">{order.number}</span>
                                  <span className="text-sm text-muted-foreground">
                                    Data: {format(parseISO(order.date), 'dd/MM/yyyy', { locale: pt })}
                                  </span>
                                  <span className="text-sm text-muted-foreground">
                                    Vence: {format(parseISO(order.dueDate), 'dd/MM/yyyy', { locale: pt })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4">
                                  {getDueBadge(order.daysUntilDue)}
                                  <span className="font-medium">{formatCurrency(order.amount)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
