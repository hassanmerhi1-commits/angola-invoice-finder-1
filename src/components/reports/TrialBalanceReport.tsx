/**
 * Balancete (Trial Balance) Report — live data from chart of accounts + journal entries.
 */

import { useMemo, useState } from 'react';
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
import { Printer, FileSpreadsheet, RefreshCw, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useTrialBalance } from '@/hooks/useChartOfAccounts';
import type { TrialBalanceRow } from '@/types/accounting';

interface AccountBalance {
  accountCode: string;
  accountName: string;
  accountType: string;
  filterKey: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

const API_TYPE_TO_FILTER: Record<string, string> = {
  asset: 'Activo',
  liability: 'Passivo',
  equity: 'Capital',
  revenue: 'Rendimento',
  expense: 'Gasto',
};

function balanceToDebitCredit(amount: number, nature: string): { debit: number; credit: number } {
  const n = Number(amount) || 0;
  if (Math.abs(n) < 0.005) return { debit: 0, credit: 0 };
  if (nature === 'credit') {
    return { debit: n < 0 ? Math.abs(n) : 0, credit: n > 0 ? n : 0 };
  }
  return { debit: n > 0 ? n : 0, credit: n < 0 ? Math.abs(n) : 0 };
}

function mapRowToAccountBalance(row: TrialBalanceRow, typeLabel: string, filterKey: string): AccountBalance {
  const opening = balanceToDebitCredit(Number(row.opening_balance), row.account_nature);
  const closing = balanceToDebitCredit(Number(row.closing_balance), row.account_nature);
  return {
    accountCode: row.code,
    accountName: row.name,
    accountType: typeLabel,
    filterKey,
    openingDebit: opening.debit,
    openingCredit: opening.credit,
    periodDebit: Number(row.total_debits) || 0,
    periodCredit: Number(row.total_credits) || 0,
    closingDebit: closing.debit,
    closingCredit: closing.credit,
  };
}

function rowHasActivity(row: TrialBalanceRow): boolean {
  return (
    !row.is_header &&
    (Math.abs(Number(row.opening_balance)) > 0.005 ||
      Number(row.total_debits) > 0 ||
      Number(row.total_credits) > 0 ||
      Math.abs(Number(row.closing_balance)) > 0.005)
  );
}

export default function TrialBalanceReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [accountType, setAccountType] = useState('all');

  const { data, isLoading, error, refetch } = useTrialBalance(startDate, endDate);

  const typeLabels = useMemo(
    () => ({
      Activo: t.trialBalanceUi.typeAssets,
      Passivo: t.trialBalanceUi.typeLiabilities,
      Capital: t.trialBalanceUi.typeEquity,
      Rendimento: t.trialBalanceUi.typeIncome,
      Gasto: t.trialBalanceUi.typeExpense,
    }),
    [t],
  );

  const accounts = useMemo(() => {
    const rows = data.filter(rowHasActivity).map((row) => {
      const filterKey = API_TYPE_TO_FILTER[row.account_type] || row.account_type;
      const typeLabel = typeLabels[filterKey as keyof typeof typeLabels] || row.account_type;
      return mapRowToAccountBalance(row, typeLabel, filterKey);
    });

    if (accountType === 'all') return rows;
    return rows.filter((a) => a.filterKey === accountType);
  }, [data, accountType, typeLabels]);

  const totals = accounts.reduce(
    (acc, account) => ({
      openingDebit: acc.openingDebit + account.openingDebit,
      openingCredit: acc.openingCredit + account.openingCredit,
      periodDebit: acc.periodDebit + account.periodDebit,
      periodCredit: acc.periodCredit + account.periodCredit,
      closingDebit: acc.closingDebit + account.closingDebit,
      closingCredit: acc.closingCredit + account.closingCredit,
    }),
    { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 },
  );

  const formatMoney = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2 });
  const dash = t.common.dash;

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
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
    const rows = accounts.map((a) => [
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

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `balancete_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
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
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {t.common.refresh}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={accounts.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-center py-16 text-muted-foreground text-sm">{t.journalsUi.noEntriesFound}</p>
          ) : (
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
                        {account.openingDebit > 0 ? formatMoney(account.openingDebit) : dash}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {account.openingCredit > 0 ? formatMoney(account.openingCredit) : dash}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {account.periodDebit > 0 ? formatMoney(account.periodDebit) : dash}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {account.periodCredit > 0 ? formatMoney(account.periodCredit) : dash}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {account.closingDebit > 0 ? formatMoney(account.closingDebit) : dash}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {account.closingCredit > 0 ? formatMoney(account.closingCredit) : dash}
                      </TableCell>
                    </TableRow>
                  ))}
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
          )}
        </CardContent>
      </Card>

      {!isLoading && accounts.length > 0 && (
        <div className="flex gap-4 text-sm">
          <div
            className={`px-4 py-2 rounded ${
              Math.abs(totals.closingDebit - totals.closingCredit) < 0.01
                ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200'
                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
            }`}
          >
            {Math.abs(totals.closingDebit - totals.closingCredit) < 0.01
              ? t.trialBalanceUi.balanceOk
              : t.trialBalanceUi.balanceDiff.replace(
                  '{amount}',
                  formatMoney(Math.abs(totals.closingDebit - totals.closingCredit)),
                )}
          </div>
        </div>
      )}
    </div>
  );
}