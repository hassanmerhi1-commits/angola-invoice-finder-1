/**
 * Balancete (Trial Balance) Report
 * Shows debit/credit balances for all accounts
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Printer, Calendar, FileSpreadsheet } from 'lucide-react';
import { useBranches, useSales, useClients, useSuppliers } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';

interface AccountBalance {
  accountCode: string;
  accountName: string;
  accountType: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

export default function TrialBalanceReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { currentBranch } = useBranches();
  const { sales } = useSales(currentBranch?.id);
  const { clients } = useClients();
  const { suppliers } = useSuppliers();
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [accountType, setAccountType] = useState('all');

  // Generate mock trial balance data based on real transactions
  const generateTrialBalance = (): AccountBalance[] => {
    const salesTotal = sales.reduce((sum, s) => sum + s.total, 0);
    const taxTotal = sales.reduce((sum, s) => sum + s.taxAmount, 0);
    const subtotal = sales.reduce((sum, s) => sum + s.subtotal, 0);
    
    const accounts: AccountBalance[] = [
      // Assets
      {
        accountCode: '11',
        accountName: 'Caixa',
        accountType: 'Activo',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: salesTotal * 0.6,
        periodCredit: 0,
        closingDebit: salesTotal * 0.6,
        closingCredit: 0,
      },
      {
        accountCode: '12',
        accountName: t.trialBalanceUi.depositsOnDemand,
        accountType: 'Activo',
        openingDebit: 500000,
        openingCredit: 0,
        periodDebit: salesTotal * 0.4,
        periodCredit: 0,
        closingDebit: 500000 + salesTotal * 0.4,
        closingCredit: 0,
      },
      {
        accountCode: '21',
        accountName: 'Clientes',
        accountType: 'Activo',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: salesTotal * 0.2,
        periodCredit: salesTotal * 0.1,
        closingDebit: salesTotal * 0.1,
        closingCredit: 0,
      },
      {
        accountCode: '31',
        accountName: 'Mercadorias',
        accountType: 'Activo',
        openingDebit: 1000000,
        openingCredit: 0,
        periodDebit: subtotal * 0.7,
        periodCredit: subtotal * 0.5,
        closingDebit: 1000000 + subtotal * 0.2,
        closingCredit: 0,
      },
      // Liabilities
      {
        accountCode: '22',
        accountName: 'Fornecedores',
        accountType: 'Passivo',
        openingDebit: 0,
        openingCredit: 200000,
        periodDebit: 150000,
        periodCredit: subtotal * 0.7,
        closingDebit: 0,
        closingCredit: 200000 - 150000 + subtotal * 0.7,
      },
      {
        accountCode: '24',
        accountName: 'Estado - IVA',
        accountType: 'Passivo',
        openingDebit: 0,
        openingCredit: 50000,
        periodDebit: taxTotal * 0.5,
        periodCredit: taxTotal,
        closingDebit: 0,
        closingCredit: 50000 + taxTotal * 0.5,
      },
      // Equity
      {
        accountCode: '51',
        accountName: 'Capital Social',
        accountType: 'Capital',
        openingDebit: 0,
        openingCredit: 1000000,
        periodDebit: 0,
        periodCredit: 0,
        closingDebit: 0,
        closingCredit: 1000000,
      },
      {
        accountCode: '59',
        accountName: 'Resultados Transitados',
        accountType: 'Capital',
        openingDebit: 0,
        openingCredit: 250000,
        periodDebit: 0,
        periodCredit: 0,
        closingDebit: 0,
        closingCredit: 250000,
      },
      // Revenue
      {
        accountCode: '71',
        accountName: t.incomeStatementUi.salesOfGoods,
        accountType: 'Rendimento',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 0,
        periodCredit: subtotal,
        closingDebit: 0,
        closingCredit: subtotal,
      },
      // Expenses
      {
        accountCode: '61',
        accountName: 'Custo das Mercadorias Vendidas',
        accountType: 'Gasto',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: subtotal * 0.6,
        periodCredit: 0,
        closingDebit: subtotal * 0.6,
        closingCredit: 0,
      },
      {
        accountCode: '62',
        accountName: t.trialBalanceUi.suppliesAndServices,
        accountType: 'Gasto',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 75000,
        periodCredit: 0,
        closingDebit: 75000,
        closingCredit: 0,
      },
      {
        accountCode: '63',
        accountName: 'Gastos com Pessoal',
        accountType: 'Gasto',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 150000,
        periodCredit: 0,
        closingDebit: 150000,
        closingCredit: 0,
      },
    ];

    if (accountType !== 'all') {
      return accounts.filter(a => a.accountType === accountType);
    }
    return accounts;
  };

  const accounts = generateTrialBalance();
  
  const totals = accounts.reduce(
    (acc, account) => ({
      openingDebit: acc.openingDebit + account.openingDebit,
      openingCredit: acc.openingCredit + account.openingCredit,
      periodDebit: acc.periodDebit + account.periodDebit,
      periodCredit: acc.periodCredit + account.periodCredit,
      closingDebit: acc.closingDebit + account.closingDebit,
      closingCredit: acc.closingCredit + account.closingCredit,
    }),
    { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 }
  );

  const formatMoney = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2 });

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    // Simplified CSV export
    const headers = [
      t.trialBalanceUi.colCode,
      t.trialBalanceUi.colAccount,
      t.trialBalanceUi.colType,
      t.trialBalanceUi.openingDebit,
      t.trialBalanceUi.openingCredit,
      t.trialBalanceUi.periodDebit,
      t.trialBalanceUi.periodCredit,
      t.trialBalanceUi.closingDebit,
      t.trialBalanceUi.closingCredit,
    ];
    const rows = accounts.map(a => [
      a.accountCode,
      a.accountName,
      a.accountType,
      a.openingDebit,
      a.openingCredit,
      a.periodDebit,
      a.periodCredit,
      a.closingDebit,
      a.closingCredit,
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `balancete_${startDate}_${endDate}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-lg">{t.trialBalanceUi.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t.reportsUi.dateFrom}</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.reportsUi.dateTo}</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.trialBalanceUi.accountType}</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="Activo">{t.trialBalanceUi.typeAssets}</SelectItem>
                  <SelectItem value="Passivo">{t.trialBalanceUi.typeLiabilities}</SelectItem>
                  <SelectItem value="Capital">{t.trialBalanceUi.typeEquity}</SelectItem>
                  <SelectItem value="Rendimento">{t.trialBalanceUi.typeIncome}</SelectItem>
                  <SelectItem value="Gasto">{t.trialBalanceUi.typeExpense}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trial Balance Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-bold" rowSpan={2}>{t.trialBalanceUi.colCode}</TableHead>
                  <TableHead className="font-bold" rowSpan={2}>{t.trialBalanceUi.colAccount}</TableHead>
                  <TableHead className="font-bold" rowSpan={2}>{t.trialBalanceUi.colType}</TableHead>
                  <TableHead className="text-center font-bold" colSpan={2}>{t.trialBalanceUi.openingBalance}</TableHead>
                  <TableHead className="text-center font-bold" colSpan={2}>{t.trialBalanceUi.periodMovement}</TableHead>
                  <TableHead className="text-center font-bold" colSpan={2}>{t.trialBalanceUi.closingBalance}</TableHead>
                </TableRow>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-right text-xs">{t.trialBalanceUi.debit}</TableHead>
                  <TableHead className="text-right text-xs">{t.trialBalanceUi.credit}</TableHead>
                  <TableHead className="text-right text-xs">{t.trialBalanceUi.debit}</TableHead>
                  <TableHead className="text-right text-xs">{t.trialBalanceUi.credit}</TableHead>
                  <TableHead className="text-right text-xs">{t.trialBalanceUi.debit}</TableHead>
                  <TableHead className="text-right text-xs">{t.trialBalanceUi.credit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.accountCode}>
                    <TableCell className="font-mono text-sm">{account.accountCode}</TableCell>
                    <TableCell>{account.accountName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{account.accountType}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {account.openingDebit > 0 ? formatMoney(account.openingDebit) : t.common.dash}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {account.openingCredit > 0 ? formatMoney(account.openingCredit) : t.common.dash}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {account.periodDebit > 0 ? formatMoney(account.periodDebit) : t.common.dash}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {account.periodCredit > 0 ? formatMoney(account.periodCredit) : t.common.dash}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium">
                      {account.closingDebit > 0 ? formatMoney(account.closingDebit) : t.common.dash}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium">
                      {account.closingCredit > 0 ? formatMoney(account.closingCredit) : t.common.dash}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="bg-primary/10 font-bold">
                  <TableCell colSpan={3} className="text-right">{t.stockValuationUi.totals}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.openingDebit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.openingCredit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.periodDebit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.periodCredit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.closingDebit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.closingCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Balance Check */}
      <div className="flex gap-4 text-sm">
        <div className={`px-4 py-2 rounded ${Math.abs(totals.closingDebit - totals.closingCredit) < 0.01 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {Math.abs(totals.closingDebit - totals.closingCredit) < 0.01 
            ? '✓ Balancete equilibrado' 
            : `✗ Diferença: ${formatMoney(Math.abs(totals.closingDebit - totals.closingCredit))} Kz`}
        </div>
      </div>
    </div>
  );
}
