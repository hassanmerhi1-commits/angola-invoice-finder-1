import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useClients, useSales } from '@/hooks/useERP';
import { Download, Printer, FileText, Search, TrendingUp, TrendingDown, FileDown } from 'lucide-react';
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useTranslation } from '@/i18n';
import { buildReportHtml, escapeHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';

interface StatementEntry {
  id: string;
  date: string;
  type: 'invoice' | 'payment' | 'credit_note' | 'debit_note';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export default function ClientStatementReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { clients } = useClients();
  const { sales } = useSales(apiBranchId, { light: false });
  
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [searchTerm, setSearchTerm] = useState('');

  const selectedClientData = useMemo(() => {
    return clients.find(c => c.id === selectedClient);
  }, [clients, selectedClient]);

  const statementEntries = useMemo((): StatementEntry[] => {
    if (!selectedClient) return [];
    
    // Get sales for this client
    const clientSales = sales.filter(sale => {
      const saleDate = sale.createdAt.split('T')[0];
      const matchesClient =
        (sale.clientId && selectedClientData?.id && sale.clientId === selectedClientData.id)
        || (!!selectedClientData?.nif && sale.customerNif === selectedClientData.nif)
        || (!!selectedClientData?.name && sale.customerName === selectedClientData.name);
      const matchesDate = saleDate >= dateFrom && saleDate <= dateTo;
      return matchesClient && matchesDate;
    });

    let runningBalance = selectedClientData?.currentBalance || 0;
    
    // Create statement entries from sales (debits - money owed by client)
    const entries: StatementEntry[] = clientSales
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(sale => {
        const isOnAccount = sale.paymentMethod === 'credit';
        const debit = sale.total;
        // Cash/card/transfer paid at sale → credit the account; on-account stays open debit.
        const credit = isOnAccount ? 0 : (sale.amountPaid >= sale.total ? sale.total : 0);
        runningBalance = runningBalance + debit - credit;
        
        return {
          id: sale.id,
          date: sale.createdAt,
          type: 'invoice' as const,
          reference: sale.invoiceNumber,
          description: `Fatura - ${sale.items.length} item(s)`,
          debit: debit,
          credit: credit,
          balance: runningBalance,
        };
      });

    return entries;
  }, [selectedClient, selectedClientData, sales, dateFrom, dateTo]);

  const totals = useMemo(() => {
    return statementEntries.reduce((acc, entry) => ({
      debit: acc.debit + entry.debit,
      credit: acc.credit + entry.credit,
    }), { debit: 0, credit: 0 });
  }, [statementEntries]);

  const filteredClients = useMemo(() => {
    if (!searchTerm) return clients;
    const term = searchTerm.toLowerCase();
    return clients.filter(c => 
      c.name.toLowerCase().includes(term) || 
      c.nif.toLowerCase().includes(term)
    );
  }, [clients, searchTerm]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency', 
      currency: 'AOA',
      minimumFractionDigits: 2 
    }).format(value);
  };

  const excelData = useMemo(() => {
    if (!selectedClientData) return [];
    return statementEntries.map((entry) => ({
      [t.reportsUi.date]: format(parseISO(entry.date), 'dd/MM/yyyy'),
      [t.reportsUi.type]:
        entry.type === 'invoice' ? t.reportsUi.invoice :
        entry.type === 'payment' ? t.reportsUi.payment :
        entry.type === 'credit_note' ? t.reportsUi.creditNote : t.reportsUi.debitNote,
      [t.reportsUi.reference]: entry.reference,
      [t.reportsUi.description]: entry.description,
      [t.reportsUi.debit]: entry.debit,
      [t.reportsUi.credit]: entry.credit,
      [t.reportsUi.balance]: entry.balance,
    }));
  }, [statementEntries, selectedClientData, t]);

  const buildPrintHtml = () => {
    if (!selectedClientData) return '';
    const rows = statementEntries
      .map(
        (entry) => `<tr>
          <td>${escapeHtml(format(parseISO(entry.date), 'dd/MM/yyyy'))}</td>
          <td>${escapeHtml(
            entry.type === 'invoice' ? t.reportsUi.invoice :
            entry.type === 'payment' ? t.reportsUi.payment :
            entry.type === 'credit_note' ? t.reportsUi.creditNote : t.reportsUi.debitNote,
          )}</td>
          <td>${escapeHtml(entry.reference)}</td>
          <td>${escapeHtml(entry.description)}</td>
          <td class="r">${entry.debit > 0 ? escapeHtml(formatCurrency(entry.debit)) : '-'}</td>
          <td class="r">${entry.credit > 0 ? escapeHtml(formatCurrency(entry.credit)) : '-'}</td>
          <td class="r b">${escapeHtml(formatCurrency(entry.balance))}</td>
        </tr>`,
      )
      .join('');
    return buildReportHtml({
      title: t.reportsUi.statementTitle,
      subtitle: `${selectedClientData.name} (${selectedClientData.nif}) — ${dateFrom} — ${dateTo}`,
      bodyHtml: `<table>
        <thead><tr>
          <th>${escapeHtml(t.reportsUi.date)}</th>
          <th>${escapeHtml(t.reportsUi.type)}</th>
          <th>${escapeHtml(t.reportsUi.reference)}</th>
          <th>${escapeHtml(t.reportsUi.description)}</th>
          <th class="r">${escapeHtml(t.reportsUi.debit)}</th>
          <th class="r">${escapeHtml(t.reportsUi.credit)}</th>
          <th class="r">${escapeHtml(t.reportsUi.balance)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tot">
          <td colspan="4">${escapeHtml(t.common.total)}</td>
          <td class="r">${escapeHtml(formatCurrency(totals.debit))}</td>
          <td class="r">${escapeHtml(formatCurrency(totals.credit))}</td>
          <td class="r">${escapeHtml(formatCurrency(totals.debit - totals.credit))}</td>
        </tr></tfoot>
      </table>`,
    });
  };

  const handleExport = async () => {
    if (!selectedClientData || excelData.length === 0) return;
    try {
      await exportReportExcel(excelData, `Extracto_${selectedClientData.name}_${format(new Date(), 'yyyyMMdd')}`, {
        title: t.reportsUi.statementTitle,
        subtitle: `${selectedClientData.name} — ${dateFrom} — ${dateTo}`,
      });
    } catch (e) {
      console.error('[ClientStatementReport] excel export failed:', e);
    }
  };

  const handlePrint = async () => {
    const html = buildPrintHtml();
    if (!html) return;
    try {
      await printReport(html);
    } catch (e) {
      console.error('[ClientStatementReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildPrintHtml();
    if (!html) return;
    try {
      await saveReportPdf(html, `Extracto_${selectedClientData?.name}_${format(new Date(), 'yyyyMMdd')}`);
    } catch (e) {
      console.error('[ClientStatementReport] save pdf failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t.reportsUi.statementTitle}
          </CardTitle>
          <CardDescription>
            {t.reportsUi.statementDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <Label>{t.reportsUi.client}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t.reportsUi.searchClient}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 mb-2"
                />
              </div>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger>
                  <SelectValue placeholder={t.reportsUi.selectClient} />
                </SelectTrigger>
                <SelectContent>
                  {filteredClients.map(client => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} ({client.nif})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.reportsUi.dateFrom}</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>{t.reportsUi.dateTo}</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
          
          {selectedClientData && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t.reportsUi.client}</p>
                  <p className="font-semibold">{selectedClientData.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.reportsUi.nif}</p>
                  <p className="font-semibold">{selectedClientData.nif}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.reportsUi.creditLimit}</p>
                  <p className="font-semibold">{formatCurrency(selectedClientData.creditLimit)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.reportsUi.balance}</p>
                  <p className={`font-semibold ${selectedClientData.currentBalance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {formatCurrency(selectedClientData.currentBalance)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statement Table */}
      {selectedClient && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Movimentos</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={excelData.length === 0}>
                  <Download className="w-4 h-4 mr-2" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleSavePdf()} disabled={statementEntries.length === 0}>
                  <FileDown className="w-4 h-4 mr-2" />
                  {t.reportsUi.savePdf}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handlePrint()} disabled={statementEntries.length === 0}>
                  <Printer className="w-4 h-4 mr-2" />
                  {t.reportsUi.print}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.reportsUi.date}</TableHead>
                  <TableHead>{t.reportsUi.type}</TableHead>
                  <TableHead>{t.reportsUi.reference}</TableHead>
                  <TableHead>{t.reportsUi.description}</TableHead>
                  <TableHead className="text-right">{t.reportsUi.debit}</TableHead>
                  <TableHead className="text-right">{t.reportsUi.credit}</TableHead>
                  <TableHead className="text-right">{t.reportsUi.balance}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statementEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {statementEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          {format(parseISO(entry.date), 'dd/MM/yyyy', { locale: pt })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={entry.type === 'invoice' ? 'default' : 
                                         entry.type === 'payment' ? 'secondary' : 'outline'}>
                            {entry.type === 'invoice' ? t.reportsUi.invoice :
                             entry.type === 'payment' ? t.reportsUi.payment :
                             entry.type === 'credit_note' ? 'NC' : 'ND'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{entry.reference}</TableCell>
                        <TableCell>{entry.description}</TableCell>
                        <TableCell className="text-right text-red-500">
                          {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                        </TableCell>
                        <TableCell className="text-right text-green-500">
                          {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${entry.balance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {formatCurrency(entry.balance)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals Row */}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={4}>{t.common.total}</TableCell>
                      <TableCell className="text-right text-red-500">
                        {formatCurrency(totals.debit)}
                      </TableCell>
                      <TableCell className="text-right text-green-500">
                        {formatCurrency(totals.credit)}
                      </TableCell>
                      <TableCell className={`text-right ${(totals.debit - totals.credit) > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {formatCurrency(totals.debit - totals.credit)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
