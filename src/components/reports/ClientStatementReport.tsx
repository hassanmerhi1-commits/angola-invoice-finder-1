import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useClients, useSales } from '@/hooks/useERP';
import { useReportCreditNotes } from '@/hooks/useReportCreditNotes';
import { Download, Printer, FileText, Search, TrendingUp, TrendingDown, FileDown } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
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

function matchesClient(
  opts: {
    clientId?: string;
    customerNif?: string;
    customerName?: string;
  },
  client: { id: string; nif: string; name: string } | undefined,
) {
  if (!client) return false;
  if (opts.clientId && opts.clientId === client.id) return true;
  if (client.nif && opts.customerNif && opts.customerNif === client.nif) return true;
  if (client.name && opts.customerName && opts.customerName === client.name) return true;
  return false;
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
  const [receipts, setReceipts] = useState<any[]>([]);

  const { creditNotes } = useReportCreditNotes(apiBranchId, { dateFrom, dateTo });

  const selectedClientData = useMemo(() => {
    return clients.find((c) => c.id === selectedClient);
  }, [clients, selectedClient]);

  useEffect(() => {
    if (!selectedClient) {
      setReceipts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await api.payments.list({
        entityType: 'customer',
        entityId: selectedClient,
        branchId: apiBranchId || undefined,
        limit: 5000,
      });
      if (!cancelled) setReceipts(Array.isArray(res.data) ? res.data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClient, apiBranchId]);

  const statementEntries = useMemo((): StatementEntry[] => {
    if (!selectedClient || !selectedClientData) return [];

    const raw: Omit<StatementEntry, 'balance'>[] = [];

    for (const sale of sales) {
      if (sale.status === 'voided') continue;
      const saleDate = String(sale.createdAt || '').slice(0, 10);
      if (saleDate < dateFrom || saleDate > dateTo) continue;
      if (
        !matchesClient(
          { clientId: sale.clientId, customerNif: sale.customerNif, customerName: sale.customerName },
          selectedClientData,
        )
      ) {
        continue;
      }
      const isOnAccount = sale.paymentMethod === 'credit';
      const debit = Number(sale.total || 0);
      const credit = isOnAccount ? 0 : Number(sale.amountPaid || 0) >= debit ? debit : 0;
      raw.push({
        id: sale.id,
        date: sale.createdAt,
        type: 'invoice',
        reference: sale.invoiceNumber,
        description: `${t.reportsUi.invoice} — ${sale.items?.length || 0} item(s)`,
        debit,
        credit,
      });
    }

    for (const note of creditNotes) {
      if (String(note.status) !== 'issued' && String(note.status) !== 'transmitted') continue;
      const noteDate = String(note.issuedAt || note.createdAt || '').slice(0, 10);
      if (noteDate < dateFrom || noteDate > dateTo) continue;
      let matched = matchesClient(
        { customerNif: note.customerNif, customerName: note.customerName },
        selectedClientData,
      );
      if (!matched && !note.customerNif && !note.customerName) {
        const orig = sales.find((s) => s.id === note.originalInvoiceId);
        matched = !!(
          orig &&
          matchesClient(
            { clientId: orig.clientId, customerNif: orig.customerNif, customerName: orig.customerName },
            selectedClientData,
          )
        );
      }
      if (!matched) continue;
      const amount = Number(note.total || 0);
      raw.push({
        id: note.id,
        date: note.issuedAt || note.createdAt,
        type: 'credit_note',
        reference: note.documentNumber,
        description: `${t.reportsUi.creditNote} — ${note.originalInvoiceNumber || ''}`.trim(),
        debit: 0,
        credit: amount,
      });
    }

    for (const pay of receipts) {
      const pType = String(pay.payment_type || pay.paymentType || '').toLowerCase();
      if (pType && pType !== 'receipt' && !pType.startsWith('rec')) continue;
      const payDate = String(pay.created_at || pay.createdAt || '').slice(0, 10);
      if (payDate < dateFrom || payDate > dateTo) continue;
      const amount = Number(pay.amount || 0);
      if (amount <= 0) continue;
      raw.push({
        id: String(pay.id),
        date: pay.created_at || pay.createdAt,
        type: 'payment',
        reference: String(pay.payment_number || pay.paymentNumber || ''),
        description: t.reportsUi.payment,
        debit: 0,
        credit: amount,
      });
    }

    raw.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const periodNet = raw.reduce((s, e) => s + e.debit - e.credit, 0);
    let running = Number(selectedClientData.currentBalance || 0) - periodNet;

    return raw.map((e) => {
      running = running + e.debit - e.credit;
      return { ...e, balance: running };
    });
  }, [
    selectedClient,
    selectedClientData,
    sales,
    creditNotes,
    receipts,
    dateFrom,
    dateTo,
    t.reportsUi.invoice,
    t.reportsUi.creditNote,
    t.reportsUi.payment,
  ]);

  const totals = useMemo(() => {
    return statementEntries.reduce(
      (acc, entry) => ({
        debit: acc.debit + entry.debit,
        credit: acc.credit + entry.credit,
      }),
      { debit: 0, credit: 0 },
    );
  }, [statementEntries]);

  const filteredClients = useMemo(() => {
    if (!searchTerm) return clients;
    const term = searchTerm.toLowerCase();
    return clients.filter(
      (c) => c.name.toLowerCase().includes(term) || c.nif.toLowerCase().includes(term),
    );
  }, [clients, searchTerm]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'AOA',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const excelData = useMemo(() => {
    if (!selectedClientData) return [];
    return statementEntries.map((entry) => ({
      [t.reportsUi.date]: format(parseISO(entry.date), 'dd/MM/yyyy'),
      [t.reportsUi.type]:
        entry.type === 'invoice'
          ? t.reportsUi.invoice
          : entry.type === 'payment'
            ? t.reportsUi.payment
            : entry.type === 'credit_note'
              ? t.reportsUi.creditNote
              : t.reportsUi.debitNote,
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
            entry.type === 'invoice'
              ? t.reportsUi.invoice
              : entry.type === 'payment'
                ? t.reportsUi.payment
                : entry.type === 'credit_note'
                  ? t.reportsUi.creditNote
                  : t.reportsUi.debitNote,
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
    if (!html || !selectedClientData) return;
    try {
      await saveReportPdf(html, `Extracto_${selectedClientData.name}_${format(new Date(), 'yyyyMMdd')}`);
    } catch (e) {
      console.error('[ClientStatementReport] save pdf failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {t.reportsUi.statementTitle}
              </CardTitle>
              <CardDescription>{t.reportsUi.statementDesc}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void handlePrint()} disabled={!selectedClient}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" onClick={() => void handleSavePdf()} disabled={!selectedClient}>
                <FileDown className="w-4 h-4 mr-2" />
                {t.reportsUi.savePdf}
              </Button>
              <Button variant="outline" onClick={() => void handleExport()} disabled={!selectedClient}>
                <Download className="w-4 h-4 mr-2" />
                {t.reportsUi.exportExcel}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <Label>{t.reportsUi.client}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={t.reportsUi.searchClient}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={selectedClient} onValueChange={setSelectedClient}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder={t.reportsUi.selectClient} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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

      {selectedClientData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-red-500" />
                <p className="text-sm text-muted-foreground">{t.reportsUi.debit}</p>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(totals.debit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-green-500" />
                <p className="text-sm text-muted-foreground">{t.reportsUi.credit}</p>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(totals.credit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-2">{t.reportsUi.balance}</p>
              <p className="text-2xl font-bold">
                {formatCurrency(
                  statementEntries[statementEntries.length - 1]?.balance ??
                    selectedClientData.currentBalance,
                )}
              </p>
              <Badge variant="secondary" className="mt-2">
                {selectedClientData.name}
              </Badge>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
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
              {!selectedClient ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t.reportsUi.selectClient}
                  </TableCell>
                </TableRow>
              ) : statementEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t.common.noResults}
                  </TableCell>
                </TableRow>
              ) : (
                statementEntries.map((entry) => (
                  <TableRow key={`${entry.type}-${entry.id}`}>
                    <TableCell>{format(parseISO(entry.date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {entry.type === 'invoice'
                          ? 'FT'
                          : entry.type === 'payment'
                            ? 'REC'
                            : entry.type === 'credit_note'
                              ? 'NC'
                              : 'ND'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{entry.reference}</TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell className="text-right">
                      {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(entry.balance)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
