import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useSuppliers } from '@/hooks/useERP';
import { Download, Printer, Truck, Search, Loader2 } from 'lucide-react';
import { format, parseISO, subMonths } from 'date-fns';
import { pt } from 'date-fns/locale';
import { exportToExcel } from '@/lib/excel';
import { api } from '@/lib/api/client';
import { getPurchaseInvoices, PurchaseInvoice } from '@/lib/purchaseInvoiceStorage';
import { useTranslation } from '@/i18n';

interface StatementEntry {
  id: string;
  date: string;
  type: 'purchase' | 'payment' | 'credit_note' | 'debit_note' | 'advance';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export default function SupplierStatementReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { suppliers } = useSuppliers();
  
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [dateFrom, setDateFrom] = useState(format(subMonths(new Date(), 6), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [statementEntries, setStatementEntries] = useState<StatementEntry[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);

  const selectedSupplierData = useMemo(() => {
    return suppliers.find(s => s.id === selectedSupplier);
  }, [suppliers, selectedSupplier]);

  // Fetch statement from backend + localStorage fallback
  useEffect(() => {
    if (!selectedSupplier) {
      setStatementEntries([]);
      setCurrentBalance(0);
      return;
    }

    const fetchStatement = async () => {
      setLoading(true);
      try {
        // 1) Try API (open_items + payments from DB)
        let apiEntries: Omit<StatementEntry, 'balance'>[] = [];
        let apiBalance = 0;
        const seenRefs = new Set<string>(); // track references to prevent duplicates

        try {
          const res = await api.payments.statement('supplier', selectedSupplier, dateFrom, dateTo);
          if (!res.error) {
            const data = res.data as any;
            const { openItems = [], payments = [], balance = { balance: 0 } } = data;
            apiBalance = parseFloat(balance.balance) || 0;

            for (const oi of openItems) {
              const docType = oi.document_type as string;
              const docNumber = oi.document_number || '';
              let type: StatementEntry['type'] = 'purchase';
              let description = '';

              // Skip payment-type entries from open_items — they'll come from payments table
              if (docType === 'payment' || docType === 'advance_payment') continue;

              if (docType === 'invoice' || docType === 'purchase_invoice') {
                type = 'purchase';
                description = t.supplierStatementUi.purchaseInvoice;
              } else if (docType === 'credit_note') {
                type = 'credit_note';
                description = t.supplierStatementUi.creditNote;
              } else if (docType === 'debit_note') {
                type = 'debit_note';
                description = t.supplierStatementUi.debitNote;
              } else if (docType === 'advance') {
                type = 'advance';
                description = t.supplierStatementUi.advance;
              } else {
                description = docType;
              }

              const amount = parseFloat(oi.original_amount) || 0;
              seenRefs.add(docNumber);
              apiEntries.push({
                id: oi.id,
                date: oi.document_date,
                type,
                reference: docNumber,
                description,
                debit: !oi.is_debit ? amount : 0,
                credit: oi.is_debit ? amount : 0,
              });
            }

            for (const p of payments) {
              const payRef = p.payment_number || '';
              // Skip if we already have this reference from open_items
              if (seenRefs.has(payRef)) continue;
              seenRefs.add(payRef);

              const amount = parseFloat(p.amount) || 0;
              apiEntries.push({
                id: p.id,
                date: p.created_at,
                type: 'payment',
                reference: payRef,
                description: t.supplierStatementUi.paymentWithMethod
                  .replace('{method}',
                    p.payment_method === 'cash' ? t.chartsUi.methodCash :
                    p.payment_method === 'transfer' ? t.chartsUi.methodTransfer :
                    p.payment_method === 'cheque' ? t.supplierStatementUi.methodCheque :
                    p.payment_method
                  ),
                debit: amount,
                credit: 0,
              });
            }
          }
        } catch (err) {
          console.warn('[SupplierStatement] API fetch failed, using localStorage:', err);
        }

        // 2) Also pull from localStorage purchase invoices (web fallback)
        const localInvoices = await getPurchaseInvoices();
        const supplierData = suppliers.find(s => s.id === selectedSupplier);
        const existingIds = new Set(apiEntries.map(e => e.id));

        for (const inv of localInvoices) {
          if (existingIds.has(inv.id)) continue; // skip duplicates
          // Match supplier by ID, NIF, or name
          const matches = supplierData && (
            inv.supplierAccountCode === supplierData.id ||
            inv.supplierNif === supplierData.nif ||
            inv.supplierName.trim().toLowerCase() === supplierData.name.trim().toLowerCase()
          );
          if (!matches) continue;
          // Date filter
          const invDate = inv.date || inv.createdAt;
          if (invDate < dateFrom || invDate > dateTo + 'T23:59:59') continue;

          apiEntries.push({
            id: inv.id,
            date: invDate,
            type: 'purchase',
            reference: inv.invoiceNumber,
            description: `${t.supplierStatementUi.purchaseInvoice} ${inv.invoiceNumber}`,
            debit: 0,
            credit: inv.total,
          });
        }

        // Sort by date
        apiEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Calculate running balance
        let runningBalance = 0;
        const finalEntries: StatementEntry[] = apiEntries.map(e => {
          runningBalance += e.credit - e.debit;
          return { ...e, balance: runningBalance };
        });

        setStatementEntries(finalEntries);
        setCurrentBalance(apiBalance || runningBalance);
      } catch (err) {
        console.error('[SupplierStatement] Fetch error:', err);
        setStatementEntries([]);
      } finally {
        setLoading(false);
      }
    };

    fetchStatement();
  }, [selectedSupplier, dateFrom, dateTo, suppliers]);

  const totals = useMemo(() => {
    return statementEntries.reduce((acc, entry) => ({
      debit: acc.debit + entry.debit,
      credit: acc.credit + entry.credit,
    }), { debit: 0, credit: 0 });
  }, [statementEntries]);

  const filteredSuppliers = useMemo(() => {
    if (!searchTerm) return suppliers;
    const term = searchTerm.toLowerCase();
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(term) || 
      s.nif.toLowerCase().includes(term)
    );
  }, [suppliers, searchTerm]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, { 
      style: 'currency', 
      currency: 'AOA',
      minimumFractionDigits: 2 
    }).format(value);
  };

  const getTypeBadge = (type: StatementEntry['type']) => {
    switch (type) {
      case 'purchase': return <Badge>{t.supplierStatementUi.purchase}</Badge>;
      case 'payment': return <Badge variant="secondary">{t.supplierStatementUi.payment}</Badge>;
      case 'credit_note': return <Badge variant="outline" className="text-green-600 border-green-600">NC</Badge>;
      case 'debit_note': return <Badge variant="outline" className="text-red-600 border-red-600">ND</Badge>;
      case 'advance': return <Badge variant="outline">{t.supplierStatementUi.advance}</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  const handleExport = () => {
    if (!selectedSupplierData) return;
    
    const data = statementEntries.map(entry => ({
      [t.common.date]: format(parseISO(entry.date), 'dd/MM/yyyy'),
      [t.reportsUi.type]:
        entry.type === 'purchase' ? t.supplierStatementUi.purchase :
        entry.type === 'payment' ? t.supplierStatementUi.payment :
        entry.type === 'credit_note' ? t.supplierStatementUi.creditNoteShort :
        entry.type === 'debit_note' ? t.supplierStatementUi.debitNoteShort :
        t.supplierStatementUi.advance,
      [t.reportsUi.reference]: entry.reference,
      [t.common.description]: entry.description,
      [t.reportsUi.debit]: entry.debit,
      [t.reportsUi.credit]: entry.credit,
      [t.reportsUi.balance]: entry.balance,
    }));
    
    exportToExcel(data, `ContaCorrente_${selectedSupplierData.name}_${format(new Date(), 'yyyyMMdd')}`);
  };

  const handlePrint = () => {
    if (!selectedSupplierData || statementEntries.length === 0) return;

    const rows = statementEntries.map(entry => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${format(parseISO(entry.date.split('T')[0]), 'dd/MM/yyyy')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${
          entry.type === 'purchase' ? 'Compra' :
          entry.type === 'payment' ? 'Pagamento' :
          entry.type === 'credit_note' ? t.supplierStatementUi.creditNoteShort :
          entry.type === 'debit_note' ? t.supplierStatementUi.debitNoteShort : t.supplierStatementUi.advance
        }</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-family:monospace;">${entry.reference}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${entry.description}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">${entry.debit > 0 ? formatCurrency(entry.debit) : '-'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">${entry.credit > 0 ? formatCurrency(entry.credit) : '-'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold;">${formatCurrency(entry.balance)}</td>
      </tr>
    `).join('');

    const html = `
      <html>
      <head><title>${t.supplierStatementUi.title} - ${selectedSupplierData.name}</title></head>
      <body style="font-family:Arial,sans-serif;padding:20px;color:#333;">
        <h2 style="margin-bottom:4px;">${t.supplierStatementUi.title}</h2>
        <p style="color:#666;margin-top:0;">${t.incomeStatementUi.periodLabel.replace('{from}', format(parseISO(dateFrom), 'dd/MM/yyyy')).replace('{to}', format(parseISO(dateTo), 'dd/MM/yyyy'))}</p>
        
        <div style="background:#f5f5f5;padding:12px;border-radius:6px;margin:16px 0;">
          <table style="width:100%;">
            <tr>
              <td><strong>${t.supplierStatementUi.supplier}:</strong> ${selectedSupplierData.name}</td>
              <td><strong>${t.reportsUi.nif}:</strong> ${selectedSupplierData.nif}</td>
              <td><strong>${t.reportsUi.balance}:</strong> ${formatCurrency(currentBalance)}</td>
            </tr>
          </table>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f0f0f0;">
              <th style="padding:8px;text-align:left;border-bottom:2px solid #999;">${t.common.date}</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #999;">${t.reportsUi.type}</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #999;">${t.reportsUi.reference}</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #999;">${t.common.description}</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #999;">${t.reportsUi.debit}</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #999;">${t.reportsUi.credit}</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #999;">${t.reportsUi.balance}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr style="background:#f0f0f0;font-weight:bold;">
              <td colspan="4" style="padding:8px;">${t.common.total}</td>
              <td style="padding:8px;text-align:right;">${formatCurrency(totals.debit)}</td>
              <td style="padding:8px;text-align:right;">${formatCurrency(totals.credit)}</td>
              <td style="padding:8px;text-align:right;">${formatCurrency(totals.credit - totals.debit)}</td>
            </tr>
          </tbody>
        </table>
        <p style="margin-top:24px;font-size:11px;color:#999;">${t.supplierStatementUi.printedAt.replace('{date}', format(new Date(), 'dd/MM/yyyy HH:mm'))}</p>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 300);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5" />
            {t.supplierStatementUi.title}
          </CardTitle>
          <CardDescription>
            {t.supplierStatementUi.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <Label>{t.supplierStatementUi.supplier}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t.supplierStatementUi.searchSupplier}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 mb-2"
                />
              </div>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger>
                  <SelectValue placeholder={t.supplierStatementUi.selectSupplier} />
                </SelectTrigger>
                <SelectContent>
                  {filteredSuppliers.map(supplier => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name} ({supplier.nif})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          
          {selectedSupplierData && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t.supplierStatementUi.supplier}</p>
                  <p className="font-semibold">{selectedSupplierData.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.reportsUi.nif}</p>
                  <p className="font-semibold">{selectedSupplierData.nif}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.supplierStatementUi.contact}</p>
                  <p className="font-semibold">{selectedSupplierData.contactPerson || t.common.dash}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.supplierStatementUi.paymentTerms}</p>
                  <p className="font-semibold">{selectedSupplierData.paymentTerms.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.reportsUi.balance}</p>
                  <p className={`font-semibold ${currentBalance > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                    {formatCurrency(currentBalance)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSupplier && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>{t.reportsUi.moves}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExport} className="no-print">
                  <Download className="w-4 h-4 mr-2" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint} className="no-print">
                  <Printer className="w-4 h-4 mr-2" />
                  {t.reportsUi.print}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.common.date}</TableHead>
                    <TableHead>{t.reportsUi.type}</TableHead>
                    <TableHead>{t.reportsUi.reference}</TableHead>
                    <TableHead>{t.common.description}</TableHead>
                    <TableHead className="text-right">{t.supplierStatementUi.debitPayment}</TableHead>
                    <TableHead className="text-right">{t.supplierStatementUi.creditPurchase}</TableHead>
                    <TableHead className="text-right">{t.reportsUi.balance}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum movimento encontrado para o período seleccionado
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {statementEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            {format(parseISO(entry.date.split('T')[0]), 'dd/MM/yyyy', { locale: pt })}
                          </TableCell>
                          <TableCell>{getTypeBadge(entry.type)}</TableCell>
                          <TableCell className="font-mono text-sm">{entry.reference}</TableCell>
                          <TableCell>{entry.description}</TableCell>
                          <TableCell className="text-right text-green-500">
                            {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-orange-500">
                            {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${entry.balance > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                            {formatCurrency(entry.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={4}>TOTAIS</TableCell>
                        <TableCell className="text-right text-green-500">
                          {formatCurrency(totals.debit)}
                        </TableCell>
                        <TableCell className="text-right text-orange-500">
                          {formatCurrency(totals.credit)}
                        </TableCell>
                        <TableCell className={`text-right ${totals.credit - totals.debit > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                          {formatCurrency(totals.credit - totals.debit)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
