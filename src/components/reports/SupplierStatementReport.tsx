import { useState, useMemo, useEffect, useRef } from 'react';
import { getPurchaseInvoices, type PurchaseInvoice } from '@/lib/purchaseInvoiceStorage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useSuppliers } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { Download, Printer, Truck, Search, Loader2 } from 'lucide-react';
import { format, parseISO, subMonths } from 'date-fns';
import { pt } from 'date-fns/locale';
import { exportToExcel } from '@/lib/excel';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { formatDisplayDate } from '@/lib/formatDisplayDate';

function isOiDebit(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

type RawRecord = Record<string, unknown>;

function normalizeStatementPayload(data: unknown) {
  const d = (data && typeof data === 'object' ? data : {}) as RawRecord;
  return {
    openItems: (d.openItems ?? d.open_items ?? []) as RawRecord[],
    payments: (d.payments ?? []) as RawRecord[],
    balance: (d.balance ?? { balance: 0 }) as { balance?: number },
  };
}

function normalizeOpenItem(oi: RawRecord) {
  return {
    id: oi.id,
    document_type: oi.document_type ?? oi.documentType,
    document_number: oi.document_number ?? oi.documentNumber,
    document_date: oi.document_date ?? oi.documentDate,
    original_amount: oi.original_amount ?? oi.originalAmount,
    remaining_amount: oi.remaining_amount ?? oi.remainingAmount,
    is_debit: oi.is_debit ?? oi.isDebit,
  };
}

function invoiceMatchesSupplier(inv: PurchaseInvoice, supplierId: string, supplier?: { id: string; nif: string; name: string }) {
  if (!supplier) return false;
  return (
    inv.supplierId === supplierId ||
    inv.supplierAccountCode === supplierId ||
    inv.supplierAccountCode === supplier.id ||
    (!!inv.supplierNif && inv.supplierNif === supplier.nif) ||
    inv.supplierName.trim().toLowerCase() === supplier.name.trim().toLowerCase()
  );
}

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
  const { apiBranchId } = useBranchScope();
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

  const fetchGenerationRef = useRef(0);

  // Fetch statement from open_items + payments, supplemented by purchase invoices
  useEffect(() => {
    if (!selectedSupplier) {
      setStatementEntries([]);
      setCurrentBalance(0);
      return;
    }

    const generation = ++fetchGenerationRef.current;
    const supplier = suppliers.find((s) => s.id === selectedSupplier);

    const fetchStatement = async () => {
      setLoading(true);
      try {
        const entries: Omit<StatementEntry, 'balance'>[] = [];
        let apiBalance: number | null = null;
        const seenRefs = new Set<string>();

        const [stmtRes, balRes] = await Promise.all([
          api.payments.statement('supplier', selectedSupplier, dateFrom, dateTo),
          api.payments.balance('supplier', selectedSupplier),
        ]);

        if (generation !== fetchGenerationRef.current) return;

        if (!balRes.error && balRes.data != null) {
          apiBalance = Number((balRes.data as { balance?: number }).balance ?? 0);
        }

        if (!stmtRes.error && stmtRes.data) {
          const { openItems, payments, balance } = normalizeStatementPayload(stmtRes.data);
          if (apiBalance === null) {
            apiBalance = Number(balance.balance ?? 0);
          }

          for (const raw of openItems) {
            const oi = normalizeOpenItem(raw);
            const docType = String(oi.document_type ?? '');
            const docNumber = String(oi.document_number ?? '');
            if (docType === 'payment' || docType === 'advance_payment') continue;
            if (docNumber && seenRefs.has(`oi:${docNumber}`)) continue;

            const original = Number(oi.original_amount ?? 0);
            const remaining = Number(oi.remaining_amount ?? oi.original_amount ?? 0);
            const isDebit = isOiDebit(oi.is_debit);
            const settled = Math.max(0, original - remaining);

            let type: StatementEntry['type'] = 'purchase';
            let description = '';

            if (docType === 'invoice' || docType === 'purchase_invoice') {
              type = 'purchase';
              description = t.supplierStatementUi.purchaseInvoice;
            } else if (docType === 'credit_note' || docType === 'supplier_return' || docType === 'purchase_return') {
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

            if (docNumber) seenRefs.add(`oi:${docNumber}`);

            entries.push({
              id: String(oi.id ?? docNumber),
              date: String(oi.document_date ?? ''),
              type,
              reference: docNumber,
              description,
              debit: isDebit ? 0 : original,
              credit: isDebit ? original : 0,
            });

            if (isDebit && settled > 0.01) {
              entries.push({
                id: `${oi.id}-settled`,
                date: String(oi.document_date ?? ''),
                type: 'credit_note',
                reference: docNumber,
                description: `${t.supplierStatementUi.creditNote} (${docNumber})`,
                debit: settled,
                credit: 0,
              });
            }
          }

          for (const raw of payments) {
            const payRef = String(raw.payment_number ?? raw.paymentNumber ?? '');
            if (payRef && seenRefs.has(`pay:${payRef}`)) continue;
            if (payRef) seenRefs.add(`pay:${payRef}`);

            const amount = Number(raw.amount ?? 0);
            const method = raw.payment_method ?? raw.paymentMethod;
            entries.push({
              id: String(raw.id ?? payRef),
              date: String(raw.created_at ?? raw.createdAt ?? ''),
              type: 'payment',
              reference: payRef,
              description: t.supplierStatementUi.paymentWithMethod.replace(
                '{method}',
                method === 'cash'
                  ? t.chartsUi.methodCash
                  : method === 'transfer'
                    ? t.chartsUi.methodTransfer
                    : method === 'cheque'
                      ? t.supplierStatementUi.methodCheque
                      : String(method ?? '')
              ),
              debit: amount,
              credit: 0,
            });
          }
        }

        if (supplier) {
          const purchaseInvoices = await getPurchaseInvoices(apiBranchId);
          if (generation !== fetchGenerationRef.current) return;

          for (const inv of purchaseInvoices) {
            if (!invoiceMatchesSupplier(inv, selectedSupplier, supplier)) continue;
            const ref = inv.invoiceNumber;
            if (ref && seenRefs.has(`oi:${ref}`)) continue;
            const invDate = inv.date || inv.createdAt;
            if (!invDate || invDate < dateFrom || invDate > `${dateTo}T23:59:59`) continue;
            if (ref) seenRefs.add(`oi:${ref}`);
            entries.push({
              id: inv.id,
              date: invDate,
              type: 'purchase',
              reference: ref,
              description: `${t.supplierStatementUi.purchaseInvoice} ${ref}`,
              debit: 0,
              credit: inv.total,
            });
          }
        }

        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let runningBalance = 0;
        const finalEntries: StatementEntry[] = entries.map((e) => {
          runningBalance += e.credit - e.debit;
          return { ...e, balance: runningBalance };
        });

        if (generation !== fetchGenerationRef.current) return;
        setStatementEntries(finalEntries);
        setCurrentBalance(apiBalance ?? runningBalance);
      } catch (err) {
        console.error('[SupplierStatement] Fetch error:', err);
        if (generation === fetchGenerationRef.current) {
          setStatementEntries([]);
          setCurrentBalance(0);
        }
      } finally {
        if (generation === fetchGenerationRef.current) {
          setLoading(false);
        }
      }
    };

    fetchStatement();
  }, [selectedSupplier, dateFrom, dateTo, language, suppliers, t, apiBranchId]);

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
                            {formatDisplayDate(entry.date?.split('T')[0] || entry.date, 'pt-AO')}
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
