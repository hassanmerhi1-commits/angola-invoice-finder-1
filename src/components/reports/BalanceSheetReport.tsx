/**
 * Balan�o Patrimonial (Balance Sheet) � live balances from chart of accounts + journals.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Printer, Scale, RefreshCw, Loader2, FileDown, FileSpreadsheet } from 'lucide-react';
import { useTranslation, type TranslationKeys } from '@/i18n';
import { resolveAccountDisplayName } from '@/lib/chartOfAccountsDisplay';
import { useBalanceSheet } from '@/hooks/useChartOfAccounts';
import type { AccountType, BalanceSheetAccountRow } from '@/types/accounting';
import { buildLineItemsTableHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';

function previousYearDate(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split('T')[0];
}

function hasBalance(row: BalanceSheetAccountRow): boolean {
  return (
    !row.is_header &&
    (Math.abs(row.current_balance) > 0.005 || Math.abs(row.previous_balance) > 0.005)
  );
}

function sumType(rows: BalanceSheetAccountRow[], type: AccountType, field: 'current_balance' | 'previous_balance') {
  return rows
    .filter((r) => !r.is_header && r.account_type === type)
    .reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

interface BalanceItem {
  code: string;
  description: string;
  currentPeriod: number;
  previousPeriod: number;
  isHeader?: boolean;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
}

function appendAccounts(
  items: BalanceItem[],
  accounts: BalanceSheetAccountRow[],
  filter: (r: BalanceSheetAccountRow) => boolean,
  language: 'en' | 'pt',
  t: TranslationKeys,
) {
  for (const row of accounts.filter((r) => hasBalance(r) && filter(r))) {
    items.push({
      code: row.code,
      description: resolveAccountDisplayName({ code: row.code, name: row.name }, language, t),
      currentPeriod: row.current_balance,
      previousPeriod: row.previous_balance,
      indent: Math.min(3, Math.max(1, row.level || 1)),
    });
  }
}

export default function BalanceSheetReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);
  const previousAsOf = useMemo(() => previousYearDate(reportDate), [reportDate]);
  const { rows, isLoading, error, refetch } = useBalanceSheet(reportDate, previousAsOf);

  const { assets, liabilitiesAndEquity, metrics, hasData } = useMemo(() => {
    const netResultCurrent = sumType(rows, 'revenue', 'current_balance') - sumType(rows, 'expense', 'current_balance');
    const netResultPrevious = sumType(rows, 'revenue', 'previous_balance') - sumType(rows, 'expense', 'previous_balance');

    const assetItems: BalanceItem[] = [
      { code: '', description: t.balanceSheetUi.assetsHeader, currentPeriod: 0, previousPeriod: 0, isHeader: true },
    ];
    appendAccounts(assetItems, rows, (r) => r.account_type === 'asset', language, t);
    const totalAssetsCurrent = sumType(rows, 'asset', 'current_balance');
    const totalAssetsPrevious = sumType(rows, 'asset', 'previous_balance');
    assetItems.push({
      code: '',
      description: t.balanceSheetUi.totalAssets,
      currentPeriod: totalAssetsCurrent,
      previousPeriod: totalAssetsPrevious,
      isTotal: true,
    });

    const leItems: BalanceItem[] = [
      {
        code: '',
        description: t.balanceSheetUi.equityAndLiabilitiesHeader,
        currentPeriod: 0,
        previousPeriod: 0,
        isHeader: true,
      },
      { code: '', description: t.balanceSheetUi.equity, currentPeriod: 0, previousPeriod: 0, isSubtotal: true },
    ];
    appendAccounts(leItems, rows, (r) => r.account_type === 'equity', language, t);
    if (Math.abs(netResultCurrent) > 0.005 || Math.abs(netResultPrevious) > 0.005) {
      leItems.push({
        code: '88',
        description: t.balanceSheetUi.netResult,
        currentPeriod: netResultCurrent,
        previousPeriod: netResultPrevious,
        indent: 1,
      });
    }
    const totalEquityCurrent = sumType(rows, 'equity', 'current_balance') + netResultCurrent;
    const totalEquityPrevious = sumType(rows, 'equity', 'previous_balance') + netResultPrevious;
    leItems.push({
      code: '',
      description: t.balanceSheetUi.totalEquity,
      currentPeriod: totalEquityCurrent,
      previousPeriod: totalEquityPrevious,
      isSubtotal: true,
    });
    leItems.push({
      code: '',
      description: t.balanceSheetUi.currentLiabilities,
      currentPeriod: 0,
      previousPeriod: 0,
      isSubtotal: true,
    });
    appendAccounts(leItems, rows, (r) => r.account_type === 'liability', language, t);
    const totalLiabilitiesCurrent = sumType(rows, 'liability', 'current_balance');
    const totalLiabilitiesPrevious = sumType(rows, 'liability', 'previous_balance');
    leItems.push({
      code: '',
      description: t.balanceSheetUi.totalLiabilities,
      currentPeriod: totalLiabilitiesCurrent,
      previousPeriod: totalLiabilitiesPrevious,
      isSubtotal: true,
    });
    leItems.push({
      code: '',
      description: t.balanceSheetUi.totalEquityAndLiabilities,
      currentPeriod: totalEquityCurrent + totalLiabilitiesCurrent,
      previousPeriod: totalEquityPrevious + totalLiabilitiesPrevious,
      isTotal: true,
    });

    const currentAssetRows = rows.filter(
      (r) => !r.is_header && r.account_type === 'asset' && /^[234](\.|$)/.test(r.code),
    );
    const totalCurrentAssets = currentAssetRows.reduce((s, r) => s + r.current_balance, 0);
    const totalPreviousCurrentAssets = currentAssetRows.reduce((s, r) => s + r.previous_balance, 0);

    return {
      hasData:
        rows.some(hasBalance) || Math.abs(netResultCurrent) > 0.005 || Math.abs(netResultPrevious) > 0.005,
      assets: assetItems,
      liabilitiesAndEquity: leItems,
      metrics: {
        totalAssetsCurrent,
        totalEquityCurrent,
        totalLiabilitiesCurrent,
        totalCurrentAssets,
        totalPreviousCurrentAssets,
        totalCurrentLiabilities: totalLiabilitiesCurrent,
        totalPreviousLiabilities: totalLiabilitiesPrevious,
      },
    };
  }, [rows, t, language]);

  const formatMoney = (value: number) => {
    if (Math.abs(value) < 0.005) return '-';
    return value.toLocaleString(locale, { minimumFractionDigits: 2 });
  };

  const allItems = useMemo(() => [...assets, ...liabilitiesAndEquity], [assets, liabilitiesAndEquity]);

  const buildExportHtml = () =>
    buildLineItemsTableHtml(
      allItems.map((item) => ({
        code: item.code,
        description: item.description,
        value: item.isHeader ? '' : formatMoney(item.currentPeriod),
        value2: item.isHeader ? '' : formatMoney(item.previousPeriod),
        isHeader: item.isHeader,
        isSubtotal: item.isSubtotal,
        isTotal: item.isTotal,
        indent: item.indent,
      })),
      {
        title: t.balanceSheetUi.title,
        subtitle: t.balanceSheetUi.asOf.replace('{date}', new Date(reportDate).toLocaleDateString(locale)),
        colCode: t.incomeStatementUi.colCode,
        colDescription: t.incomeStatementUi.colDescription,
        colValue: t.balanceSheetUi.currentPeriod,
        colValue2: t.balanceSheetUi.previousPeriod,
      },
    );

  const handlePrint = async () => {
    if (!hasData) return;
    try {
      await printReport(buildExportHtml());
    } catch (e) {
      console.error('[BalanceSheetReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    if (!hasData) return;
    try {
      await saveReportPdf(buildExportHtml(), `balanco_${reportDate}`);
    } catch (e) {
      console.error('[BalanceSheetReport] save pdf failed:', e);
    }
  };

  const handleExportExcel = async () => {
    const data = allItems
      .filter((item) => !item.isHeader)
      .map((item) => ({
        [t.incomeStatementUi.colCode]: item.code,
        [t.incomeStatementUi.colDescription]: item.description,
        [t.balanceSheetUi.currentPeriod]: item.currentPeriod,
        [t.balanceSheetUi.previousPeriod]: item.previousPeriod,
      }));
    try {
      await exportReportExcel(data, `balanco_${reportDate}`, {
        title: t.balanceSheetUi.title,
        subtitle: t.balanceSheetUi.asOf.replace('{date}', new Date(reportDate).toLocaleDateString(locale)),
      });
    } catch (e) {
      console.error('[BalanceSheetReport] excel export failed:', e);
    }
  };

  const renderSection = (items: BalanceItem[]) => (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div
          key={index}
          className={`flex justify-between py-2 px-3 rounded ${
            item.isTotal
              ? 'bg-primary text-primary-foreground font-bold'
              : item.isHeader
              ? 'bg-muted/80 font-bold text-lg border-b-2'
              : item.isSubtotal
              ? 'bg-muted/50 font-semibold'
              : 'hover:bg-muted/30'
          }`}
          style={{ paddingLeft: item.indent ? `${item.indent * 20 + 12}px` : undefined }}
        >
          <div className="flex items-center gap-4">
            {item.code && (
              <span className="font-mono text-xs text-muted-foreground w-8">{item.code}</span>
            )}
            <span>{item.description}</span>
          </div>
          <div className="flex gap-8">
            <span className={`font-mono w-32 text-right ${item.isTotal ? 'text-primary-foreground' : ''}`}>
              {item.isHeader ? '' : formatMoney(item.currentPeriod)}
            </span>
            <span className={`font-mono w-32 text-right text-muted-foreground ${item.isTotal ? 'text-primary-foreground/70' : ''}`}>
              {item.isHeader ? '' : formatMoney(item.previousPeriod)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Scale className="w-5 h-5" />
            {t.balanceSheetUi.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t.balanceSheetUi.referenceDate}</Label>
              <Input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {t.common.refresh}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handlePrint()} disabled={!hasData}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleSavePdf()} disabled={!hasData}>
                <FileDown className="w-4 h-4 mr-2" />
                {t.reportsUi.savePdf}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleExportExcel()} disabled={!hasData}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>{t.balanceSheetUi.asOf.replace('{date}', new Date(reportDate).toLocaleDateString(locale))}</CardTitle>
            <div className="flex gap-8 text-sm font-medium">
              <span>{t.balanceSheetUi.currentPeriod}</span>
              <span className="text-muted-foreground">{t.balanceSheetUi.previousPeriod}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : !hasData ? (
            <p className="text-center py-16 text-muted-foreground text-sm">{t.journalsUi.noEntriesFound}</p>
          ) : (
            <>
              {renderSection(assets)}
              <Separator />
              {renderSection(liabilitiesAndEquity)}
            </>
          )}
        </CardContent>
      </Card>

      {!isLoading && hasData && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.currentRatio}</p>
            <p className="text-2xl font-bold text-blue-600">
              {metrics.totalCurrentLiabilities > 0
                ? (metrics.totalCurrentAssets / metrics.totalCurrentLiabilities).toFixed(2)
                : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.financialAutonomy}</p>
            <p className="text-2xl font-bold text-green-600">
              {metrics.totalAssetsCurrent > 0
                ? ((metrics.totalEquityCurrent / metrics.totalAssetsCurrent) * 100).toFixed(1)
                : 0}
              %
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.debtRatio}</p>
            <p className="text-2xl font-bold text-orange-600">
              {metrics.totalAssetsCurrent > 0
                ? ((metrics.totalLiabilitiesCurrent / metrics.totalAssetsCurrent) * 100).toFixed(1)
                : 0}
              %
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.workingCapital}</p>
            <p
              className={`text-2xl font-bold ${
                metrics.totalCurrentAssets - metrics.totalCurrentLiabilities >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}
            >
              {formatMoney(metrics.totalCurrentAssets - metrics.totalCurrentLiabilities)} Kz
            </p>
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  );
}
