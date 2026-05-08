import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useClients, useSales } from '@/hooks/useERP';
import { Download, Clock, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';
import { exportToExcel } from '@/lib/excel';
import { useTranslation } from '@/i18n';

interface AgingEntry {
  clientId: string;
  clientName: string;
  clientNif: string;
  current: number; // 0-30 days
  days30: number; // 31-60 days
  days60: number; // 61-90 days
  days90: number; // 90+ days
  total: number;
  creditLimit: number;
  invoices: {
    id: string;
    number: string;
    date: string;
    amount: number;
    daysOverdue: number;
  }[];
}

export default function AccountsReceivableReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { clients } = useClients();
  const { sales } = useSales();
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  const agingReport = useMemo((): AgingEntry[] => {
    const today = new Date();
    const clientAging: Record<string, AgingEntry> = {};
    
    // Group sales by client and calculate aging
    sales
      .filter(sale => sale.status === 'completed')
      .forEach(sale => {
        // Find matching client
        const client = clients.find(c => 
          c.nif === sale.customerNif || c.name === sale.customerName
        );
        
        if (!client || client.currentBalance <= 0) return;
        
        const clientId = client.id;
        if (!clientAging[clientId]) {
          clientAging[clientId] = {
            clientId,
            clientName: client.name,
            clientNif: client.nif,
            current: 0,
            days30: 0,
            days60: 0,
            days90: 0,
            total: 0,
            creditLimit: client.creditLimit,
            invoices: [],
          };
        }
        
        const saleDate = parseISO(sale.createdAt);
        const daysOverdue = differenceInDays(today, saleDate);
        const amount = sale.total - sale.amountPaid;
        
        if (amount <= 0) return;
        
        // Add to appropriate aging bucket
        if (daysOverdue <= 30) {
          clientAging[clientId].current += amount;
        } else if (daysOverdue <= 60) {
          clientAging[clientId].days30 += amount;
        } else if (daysOverdue <= 90) {
          clientAging[clientId].days60 += amount;
        } else {
          clientAging[clientId].days90 += amount;
        }
        
        clientAging[clientId].total += amount;
        clientAging[clientId].invoices.push({
          id: sale.id,
          number: sale.invoiceNumber,
          date: sale.createdAt,
          amount,
          daysOverdue,
        });
      });
    
    // Also add clients with positive balance but no matching sales
    clients
      .filter(c => c.currentBalance > 0 && !clientAging[c.id])
      .forEach(client => {
        clientAging[client.id] = {
          clientId: client.id,
          clientName: client.name,
          clientNif: client.nif,
          current: client.currentBalance, // Assume current
          days30: 0,
          days60: 0,
          days90: 0,
          total: client.currentBalance,
          creditLimit: client.creditLimit,
          invoices: [],
        };
      });
    
    return Object.values(clientAging)
      .filter(entry => entry.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [clients, sales]);

  const summaryStats = useMemo(() => {
    return agingReport.reduce((acc, entry) => ({
      current: acc.current + entry.current,
      days30: acc.days30 + entry.days30,
      days60: acc.days60 + entry.days60,
      days90: acc.days90 + entry.days90,
      total: acc.total + entry.total,
    }), { current: 0, days30: 0, days60: 0, days90: 0, total: 0 });
  }, [agingReport]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency', 
      currency: 'AOA',
      minimumFractionDigits: 0 
    }).format(value);
  };

  const getAgingBadge = (daysOverdue: number) => {
    if (daysOverdue <= 30) {
      return <Badge variant="secondary" className="bg-green-500/10 text-green-500">{t.reportsUi.current0to30}</Badge>;
    } else if (daysOverdue <= 60) {
      return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500">{t.reportsUi.days31to60}</Badge>;
    } else if (daysOverdue <= 90) {
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500">{t.reportsUi.days61to90}</Badge>;
    } else {
      return <Badge variant="destructive">{t.reportsUi.days90plus}</Badge>;
    }
  };

  const handleExport = () => {
    const data = agingReport.map(entry => ({
      [t.reportsUi.client]: entry.clientName,
      [t.reportsUi.nif]: entry.clientNif,
      [t.reportsUi.current0to30]: entry.current,
      [t.reportsUi.days31to60]: entry.days30,
      [t.reportsUi.days61to90]: entry.days60,
      [t.reportsUi.days90plus]: entry.days90,
      [t.reportsUi.total]: entry.total,
      [t.reportsUi.creditLimit]: entry.creditLimit,
      [t.reportsUi.percentUsed]: ((entry.total / entry.creditLimit) * 100).toFixed(1),
    }));
    
    exportToExcel(data, `ContasReceber_Aging_${format(new Date(), 'yyyyMMdd')}`);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
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

      {/* Aging Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                {t.reportsUi.receivablesTitle}
              </CardTitle>
              <CardDescription>
                Saldos de clientes organizados por tempo de vencimento
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
                <TableHead>{t.reportsUi.client}</TableHead>
                <TableHead>{t.reportsUi.nif}</TableHead>
                <TableHead className="text-right text-green-500">{t.reportsUi.current0to30}</TableHead>
                <TableHead className="text-right text-yellow-500">{t.reportsUi.days31to60}</TableHead>
                <TableHead className="text-right text-orange-500">{t.reportsUi.days61to90}</TableHead>
                <TableHead className="text-right text-red-500">{t.reportsUi.days90plus}</TableHead>
                <TableHead className="text-right">{t.reportsUi.total}</TableHead>
                <TableHead>{t.reportsUi.percentUsed}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingReport.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {t.common.noResults}
                  </TableCell>
                </TableRow>
              ) : (
                agingReport.map((entry) => {
                  const creditUsage = entry.creditLimit > 0 
                    ? (entry.total / entry.creditLimit) * 100 
                    : 100;
                  
                  return (
                    <>
                      <TableRow 
                        key={entry.clientId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedClient(
                          expandedClient === entry.clientId ? null : entry.clientId
                        )}
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
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress 
                              value={Math.min(creditUsage, 100)} 
                              className={`h-2 w-20 ${creditUsage > 80 ? '[&>div]:bg-red-500' : creditUsage > 50 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-green-500'}`}
                            />
                            <span className={`text-sm ${creditUsage > 80 ? 'text-red-500' : ''}`}>
                              {creditUsage.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedClient === entry.clientId && entry.invoices.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-4">
                            <p className="text-sm font-medium mb-2">{t.reportsUi.openInvoices}</p>
                            <div className="space-y-2">
                              {entry.invoices.map(inv => (
                                <div key={inv.id} className="flex items-center justify-between p-2 bg-background rounded">
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
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
