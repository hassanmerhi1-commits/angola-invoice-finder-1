/**
 * Balanço Patrimonial (Balance Sheet)
 * Shows assets, liabilities, and equity
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Download, Printer, FileSpreadsheet, Scale } from 'lucide-react';
import { useBranches, useSales } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';

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

export default function BalanceSheetReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { currentBranch } = useBranches();
  const { sales } = useSales(currentBranch?.id);
  
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Calculate from real data
  const salesTotal = sales.reduce((sum, s) => sum + s.total, 0);
  const netProfit = salesTotal * 0.15; // Simplified

  const formatMoney = (value: number) => {
    if (value === 0) return '-';
    return value.toLocaleString(locale, { minimumFractionDigits: 2 });
  };

  // Balance Sheet Structure
  const assets: BalanceItem[] = [
    { code: '', description: t.balanceSheetUi.assetsHeader, currentPeriod: 0, previousPeriod: 0, isHeader: true },
    { code: '', description: t.balanceSheetUi.nonCurrentAssets, currentPeriod: 0, previousPeriod: 0, isSubtotal: true },
    { code: '43', description: t.balanceSheetUi.tangibleFixedAssets, currentPeriod: 500000, previousPeriod: 550000, indent: 1 },
    { code: '44', description: t.balanceSheetUi.intangibleAssets, currentPeriod: 50000, previousPeriod: 60000, indent: 1 },
    { code: '', description: t.balanceSheetUi.totalNonCurrentAssets, currentPeriod: 550000, previousPeriod: 610000, isSubtotal: true },
    
    { code: '', description: t.balanceSheetUi.currentAssets, currentPeriod: 0, previousPeriod: 0, isSubtotal: true },
    { code: '31', description: t.balanceSheetUi.inventories, currentPeriod: 1000000 + salesTotal * 0.2, previousPeriod: 1000000, indent: 1 },
    { code: '21', description: t.balanceSheetUi.customers, currentPeriod: salesTotal * 0.1, previousPeriod: 150000, indent: 1 },
    { code: '12', description: t.balanceSheetUi.bankDeposits, currentPeriod: 500000 + salesTotal * 0.4, previousPeriod: 500000, indent: 1 },
    { code: '11', description: t.balanceSheetUi.cash, currentPeriod: salesTotal * 0.6, previousPeriod: 100000, indent: 1 },
  ];

  const totalCurrentAssets = 1000000 + salesTotal * 0.2 + salesTotal * 0.1 + 500000 + salesTotal * 0.4 + salesTotal * 0.6;
  const totalAssets = 550000 + totalCurrentAssets;
  const prevCurrentAssets = 1000000 + 150000 + 500000 + 100000;
  const prevTotalAssets = 610000 + prevCurrentAssets;

  assets.push(
    { code: '', description: t.balanceSheetUi.totalCurrentAssets, currentPeriod: totalCurrentAssets, previousPeriod: prevCurrentAssets, isSubtotal: true },
    { code: '', description: t.balanceSheetUi.totalAssets, currentPeriod: totalAssets, previousPeriod: prevTotalAssets, isTotal: true }
  );

  const liabilitiesAndEquity: BalanceItem[] = [
    { code: '', description: t.balanceSheetUi.equityAndLiabilitiesHeader, currentPeriod: 0, previousPeriod: 0, isHeader: true },
    
    { code: '', description: t.balanceSheetUi.equity, currentPeriod: 0, previousPeriod: 0, isSubtotal: true },
    { code: '51', description: t.balanceSheetUi.shareCapital, currentPeriod: 1000000, previousPeriod: 1000000, indent: 1 },
    { code: '55', description: t.balanceSheetUi.legalReserves, currentPeriod: 100000, previousPeriod: 80000, indent: 1 },
    { code: '59', description: t.balanceSheetUi.retainedEarnings, currentPeriod: 250000, previousPeriod: 200000, indent: 1 },
    { code: '88', description: t.balanceSheetUi.netResult, currentPeriod: netProfit, previousPeriod: 150000, indent: 1 },
  ];

  const totalEquity = 1000000 + 100000 + 250000 + netProfit;
  const prevTotalEquity = 1000000 + 80000 + 200000 + 150000;

  liabilitiesAndEquity.push(
    { code: '', description: t.balanceSheetUi.totalEquity, currentPeriod: totalEquity, previousPeriod: prevTotalEquity, isSubtotal: true },
    
    { code: '', description: t.balanceSheetUi.nonCurrentLiabilities, currentPeriod: 0, previousPeriod: 0, isSubtotal: true },
    { code: '25', description: t.balanceSheetUi.borrowings, currentPeriod: 200000, previousPeriod: 250000, indent: 1 },
    { code: '', description: t.balanceSheetUi.totalNonCurrentLiabilities, currentPeriod: 200000, previousPeriod: 250000, isSubtotal: true },
    
    { code: '', description: t.balanceSheetUi.currentLiabilities, currentPeriod: 0, previousPeriod: 0, isSubtotal: true },
    { code: '22', description: t.balanceSheetUi.suppliers, currentPeriod: totalAssets - totalEquity - 200000 - 50000, previousPeriod: 300000, indent: 1 },
    { code: '24', description: t.balanceSheetUi.stateAndPublicEntities, currentPeriod: 50000, previousPeriod: 40000, indent: 1 }
  );

  const totalCurrentLiabilities = totalAssets - totalEquity - 200000;
  const prevCurrentLiabilities = prevTotalAssets - prevTotalEquity - 250000;
  const totalLiabilities = 200000 + totalCurrentLiabilities;
  const prevTotalLiabilities = 250000 + prevCurrentLiabilities;

  liabilitiesAndEquity.push(
    { code: '', description: t.balanceSheetUi.totalCurrentLiabilities, currentPeriod: totalCurrentLiabilities, previousPeriod: prevCurrentLiabilities, isSubtotal: true },
    { code: '', description: t.balanceSheetUi.totalLiabilities, currentPeriod: totalLiabilities, previousPeriod: prevTotalLiabilities, isSubtotal: true },
    { code: '', description: t.balanceSheetUi.totalEquityAndLiabilities, currentPeriod: totalAssets, previousPeriod: prevTotalAssets, isTotal: true }
  );

  const handlePrint = () => {
    window.print();
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
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm">
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance Sheet */}
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
          {/* Assets */}
          {renderSection(assets)}
          
          <Separator />
          
          {/* Liabilities and Equity */}
          {renderSection(liabilitiesAndEquity)}
        </CardContent>
      </Card>

      {/* Key Ratios */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.currentRatio}</p>
            <p className="text-2xl font-bold text-blue-600">
              {totalCurrentLiabilities > 0 ? (totalCurrentAssets / totalCurrentLiabilities).toFixed(2) : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.financialAutonomy}</p>
            <p className="text-2xl font-bold text-green-600">
              {totalAssets > 0 ? ((totalEquity / totalAssets) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.debtRatio}</p>
            <p className="text-2xl font-bold text-orange-600">
              {totalAssets > 0 ? ((totalLiabilities / totalAssets) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.balanceSheetUi.workingCapital}</p>
            <p className={`text-2xl font-bold ${totalCurrentAssets - totalCurrentLiabilities >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatMoney(totalCurrentAssets - totalCurrentLiabilities)} Kz
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
