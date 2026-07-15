/**
 * Demonstração de Resultados (Income Statement / P&L)
 * Shows revenues, expenses and profit/loss
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Download, Printer, FileSpreadsheet, FileDown, TrendingUp, TrendingDown } from 'lucide-react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { buildLineItemsTableHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';

interface LineItem {
  code: string;
  description: string;
  value: number;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
}

export default function IncomeStatementReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setMonth(0, 1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Calculate from real data
  const salesTotal = sales.reduce((sum, s) => sum + s.subtotal, 0);
  const taxTotal = sales.reduce((sum, s) => sum + s.taxAmount, 0);
  
  // Mock cost percentages (in real system, would come from purchases/inventory)
  const costOfGoodsSold = salesTotal * 0.6;
  const grossProfit = salesTotal - costOfGoodsSold;
  
  const operatingExpenses = {
    supplies: 75000,
    personnel: 150000,
    depreciation: 25000,
    other: 35000,
  };
  const totalOperatingExpenses = Object.values(operatingExpenses).reduce((a, b) => a + b, 0);
  
  const operatingProfit = grossProfit - totalOperatingExpenses;
  
  const financialItems = {
    financialIncome: 5000,
    financialExpenses: -15000,
  };
  const financialResult = financialItems.financialIncome + financialItems.financialExpenses;
  
  const profitBeforeTax = operatingProfit + financialResult;
  const incomeTax = profitBeforeTax > 0 ? profitBeforeTax * 0.25 : 0;
  const netProfit = profitBeforeTax - incomeTax;

  const formatMoney = (value: number) => {
    const formatted = Math.abs(value).toLocaleString(locale, { minimumFractionDigits: 2 });
    return value < 0 ? `(${formatted})` : formatted;
  };

  const lineItems: LineItem[] = [
    { code: '71', description: t.incomeStatementUi.salesOfGoods, value: salesTotal },
    { code: '72', description: t.incomeStatementUi.servicesProvided, value: 0 },
    { code: '73', description: t.incomeStatementUi.otherOperatingIncome, value: 0 },
    { code: '', description: t.incomeStatementUi.operatingIncome, value: salesTotal, isSubtotal: true },
    
    { code: '61', description: t.incomeStatementUi.costOfGoodsSold, value: -costOfGoodsSold, indent: 1 },
    { code: '', description: t.incomeStatementUi.grossResult, value: grossProfit, isSubtotal: true },
    
    { code: '62', description: t.incomeStatementUi.externalSuppliesServices, value: -operatingExpenses.supplies, indent: 1 },
    { code: '63', description: t.incomeStatementUi.personnelExpenses, value: -operatingExpenses.personnel, indent: 1 },
    { code: '64', description: t.incomeStatementUi.depreciationAmortization, value: -operatingExpenses.depreciation, indent: 1 },
    { code: '65', description: t.incomeStatementUi.otherOperatingExpenses, value: -operatingExpenses.other, indent: 1 },
    { code: '', description: t.incomeStatementUi.totalOperatingExpenses, value: -totalOperatingExpenses, isSubtotal: true },
    
    { code: '', description: t.incomeStatementUi.operatingResult, value: operatingProfit, isSubtotal: true },
    
    { code: '78', description: t.incomeStatementUi.financialIncome, value: financialItems.financialIncome, indent: 1 },
    { code: '68', description: t.incomeStatementUi.financialExpenses, value: financialItems.financialExpenses, indent: 1 },
    { code: '', description: t.incomeStatementUi.financialResult, value: financialResult, isSubtotal: true },
    
    { code: '', description: t.incomeStatementUi.resultBeforeTax, value: profitBeforeTax, isSubtotal: true },
    
    { code: '81', description: t.incomeStatementUi.incomeTax, value: -incomeTax, indent: 1 },
    
    { code: '', description: t.incomeStatementUi.netResult, value: netProfit, isTotal: true },
  ];

  const handlePrint = async () => {
    const html = buildLineItemsTableHtml(
      lineItems.map((item) => ({
        code: item.code,
        description: item.description,
        value: `${formatMoney(item.value)} Kz`,
        isSubtotal: item.isSubtotal,
        isTotal: item.isTotal,
        indent: item.indent,
      })),
      {
        title: t.incomeStatementUi.title,
        subtitle: t.incomeStatementUi.periodLabel
          .replace('{from}', new Date(startDate).toLocaleDateString(locale))
          .replace('{to}', new Date(endDate).toLocaleDateString(locale)),
        colCode: t.incomeStatementUi.colCode,
        colDescription: t.incomeStatementUi.colDescription,
        colValue: t.incomeStatementUi.colValueKz,
      },
    );
    try {
      await printReport(html);
    } catch (e) {
      console.error('[IncomeStatementReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildLineItemsTableHtml(
      lineItems.map((item) => ({
        code: item.code,
        description: item.description,
        value: `${formatMoney(item.value)} Kz`,
        isSubtotal: item.isSubtotal,
        isTotal: item.isTotal,
        indent: item.indent,
      })),
      {
        title: t.incomeStatementUi.title,
        subtitle: t.incomeStatementUi.periodLabel
          .replace('{from}', new Date(startDate).toLocaleDateString(locale))
          .replace('{to}', new Date(endDate).toLocaleDateString(locale)),
        colCode: t.incomeStatementUi.colCode,
        colDescription: t.incomeStatementUi.colDescription,
        colValue: t.incomeStatementUi.colValueKz,
      },
    );
    try {
      await saveReportPdf(html, `demonstracao_resultados_${startDate}_${endDate}`);
    } catch (e) {
      console.error('[IncomeStatementReport] save pdf failed:', e);
    }
  };

  const handleExportExcel = async () => {
    const data = lineItems.map((item) => ({
      [t.incomeStatementUi.colCode]: item.code,
      [t.incomeStatementUi.colDescription]: item.description,
      [t.incomeStatementUi.colValueKz]: item.value,
    }));
    try {
      await exportReportExcel(data, `demonstracao_resultados_${startDate}_${endDate}`, {
        title: t.incomeStatementUi.title,
        subtitle: t.incomeStatementUi.periodLabel
          .replace('{from}', new Date(startDate).toLocaleDateString(locale))
          .replace('{to}', new Date(endDate).toLocaleDateString(locale)),
      });
    } catch (e) {
      console.error('[IncomeStatementReport] excel export failed:', e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-lg">{t.incomeStatementUi.title}</CardTitle>
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
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => void handlePrint()}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleSavePdf()}>
                <FileDown className="w-4 h-4 mr-2" />
                {t.reportsUi.savePdf}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleExportExcel()}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Income Statement */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>
              {t.incomeStatementUi.periodLabel.replace('{from}', new Date(startDate).toLocaleDateString(locale)).replace('{to}', new Date(endDate).toLocaleDateString(locale))}
            </CardTitle>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${netProfit >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {netProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              <span className="font-bold">{formatMoney(netProfit)} Kz</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {lineItems.map((item, index) => (
              <div
                key={index}
                className={`flex justify-between py-2 px-3 rounded ${
                  item.isTotal
                    ? 'bg-primary text-primary-foreground font-bold text-lg'
                    : item.isSubtotal
                    ? 'bg-muted font-semibold border-t border-b'
                    : 'hover:bg-muted/50'
                }`}
                style={{ paddingLeft: item.indent ? `${item.indent * 20 + 12}px` : undefined }}
              >
                <div className="flex items-center gap-4">
                  {item.code && (
                    <span className="font-mono text-xs text-muted-foreground w-8">{item.code}</span>
                  )}
                  <span>{item.description}</span>
                </div>
                <span className={`font-mono ${item.value < 0 ? 'text-red-600' : ''} ${item.isTotal ? 'text-primary-foreground' : ''}`}>
                  {formatMoney(item.value)} Kz
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.incomeStatementUi.grossMargin}</p>
            <p className="text-2xl font-bold text-green-600">
              {salesTotal > 0 ? ((grossProfit / salesTotal) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.incomeStatementUi.operatingMargin}</p>
            <p className="text-2xl font-bold text-blue-600">
              {salesTotal > 0 ? ((operatingProfit / salesTotal) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.incomeStatementUi.netMargin}</p>
            <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {salesTotal > 0 ? ((netProfit / salesTotal) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.incomeStatementUi.salesVolume}</p>
            <p className="text-2xl font-bold">{formatMoney(salesTotal)} Kz</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
