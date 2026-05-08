import { useState } from 'react';
import { useDailyReports, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar as CalendarIcon, FileText, Lock, RefreshCw, TrendingUp, DollarSign, CreditCard, Banknote, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { DailySalesDetailReport } from '@/components/reports/DailySalesDetailReport';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';
import { useTranslation } from '@/i18n';
import { enUS } from 'date-fns/locale';

export default function DailyReports() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { user } = useAuth();
  const { branches, currentBranch } = useBranchContext();
  const { reports, generateReport, closeDay, refreshReports } = useDailyReports(currentBranch?.id);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = useState<string>(currentBranch?.id || 'all');
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [closingBalance, setClosingBalance] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  
  // Detail report dialog
  const [detailReportOpen, setDetailReportOpen] = useState(false);
  const [detailReportStartDate, setDetailReportStartDate] = useState('');
  const [detailReportEndDate, setDetailReportEndDate] = useState('');
  const [detailReportBranchId, setDetailReportBranchId] = useState<string | undefined>();
  const [detailReportBranchName, setDetailReportBranchName] = useState<string | undefined>();

  const isMainOffice = currentBranch?.isMain;
  
  // Filter reports by date range
  const filteredReports = reports.filter(r => {
    const reportDate = new Date(r.date);
    const matchesBranch = !isMainOffice || selectedBranch === 'all' || r.branchId === selectedBranch;
    const matchesDateRange = dateRange?.from && dateRange?.to 
      ? reportDate >= dateRange.from && reportDate <= dateRange.to
      : true;
    return matchesBranch && matchesDateRange;
  });

  const handleGenerateReport = () => {
    const branchId = isMainOffice && selectedBranch && selectedBranch !== 'all' ? selectedBranch : currentBranch?.id;
    const selectedDate = dateRange?.from ? dateRange.from.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    if (branchId) {
      generateReport(branchId, selectedDate);
    }
  };

  const handleCloseDay = () => {
    if (selectedReport && user) {
      closeDay(selectedReport, parseFloat(closingBalance) || 0, closingNotes, user.id);
      setCloseDialogOpen(false);
      setClosingBalance('');
      setClosingNotes('');
      setSelectedReport(null);
    }
  };

  const openCloseDialog = (reportId: string, currentBalance: number) => {
    setSelectedReport(reportId);
    setClosingBalance(currentBalance.toString());
    setCloseDialogOpen(true);
  };

  const openDetailReport = (startDate: string, endDate: string, branchId: string, branchName: string) => {
    setDetailReportStartDate(startDate);
    setDetailReportEndDate(endDate);
    setDetailReportBranchId(branchId);
    setDetailReportBranchName(branchName);
    setDetailReportOpen(true);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(uiLocale, { style: 'currency', currency: 'AOA' }).format(value);
  };

  // Calculate totals for summary cards
  const totalRevenue = filteredReports.reduce((sum, r) => sum + r.totalSales, 0);
  const totalTransactions = filteredReports.reduce((sum, r) => sum + r.totalTransactions, 0);
  const totalCash = filteredReports.reduce((sum, r) => sum + r.cashTotal, 0);
  const totalCard = filteredReports.reduce((sum, r) => sum + r.cardTotal, 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.dailyReportsUi.title}</h1>
          <p className="text-muted-foreground">{t.dailyReportsUi.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refreshReports}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t.common.refresh}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.dailyReportsUi.totalRevenue}</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              {t.dailyReportsUi.reportsCount.replace('{count}', String(filteredReports.length))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.dailyReportsUi.transactions}</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTransactions}</div>
            <p className="text-xs text-muted-foreground">{t.dailyReportsUi.salesDone}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.dailyReportsUi.cash}</CardTitle>
            <Banknote className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalCash)}</div>
            <p className="text-xs text-muted-foreground">{t.dailyReportsUi.inCash}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.dailyReportsUi.card}</CardTitle>
            <CreditCard className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalCard)}</div>
            <p className="text-xs text-muted-foreground">{t.dailyReportsUi.inCard}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.dailyReportsUi.generateTitle}</CardTitle>
          <CardDescription>{t.dailyReportsUi.generateSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label>{t.dailyReportsUi.periodLabel}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateRange && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "dd/MM/yyyy", { locale: dfLocale })} -{" "}
                          {format(dateRange.to, "dd/MM/yyyy", { locale: dfLocale })}
                        </>
                      ) : (
                        format(dateRange.from, "dd/MM/yyyy", { locale: dfLocale })
                      )
                    ) : (
                      <span>{t.dailyReportsUi.selectPeriod}</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            {isMainOffice && (
              <div className="flex-1">
                <Label htmlFor="branch">Filial</Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.dailyReportsUi.allBranches} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">{t.dailyReportsUi.allBranches}</SelectItem>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name} {branch.isMain && t.dailyReportsUi.headOfficeSuffix}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-end gap-2">
              <Button onClick={handleGenerateReport}>
                <CalendarIcon className="w-4 h-4 mr-2" />
                {t.dailyReportsUi.generateButton}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  const startDate = dateRange?.from?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0];
                  const endDate = dateRange?.to?.toISOString().split('T')[0] || startDate;
                  openDetailReport(
                    startDate,
                    endDate,
                    isMainOffice && selectedBranch && selectedBranch !== 'all' ? selectedBranch : currentBranch?.id || '',
                    isMainOffice && selectedBranch && selectedBranch !== 'all' ? branches.find(b => b.id === selectedBranch)?.name || '' : currentBranch?.name || ''
                  );
                }}
              >
                <Eye className="w-4 h-4 mr-2" />
                {t.dailyReportsUi.viewDetails}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t.dailyReportsUi.reportsTitle}</CardTitle>
          <CardDescription>
            {isMainOffice
              ? t.dailyReportsUi.allBranchesReports
              : t.dailyReportsUi.reportsOfBranch.replace('{name}', String(currentBranch?.name || ''))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{t.dailyReportsUi.colBranch}</TableHead>
                <TableHead className="text-right">{t.dailyReportsUi.colSales}</TableHead>
                <TableHead className="text-right">{t.dailyReportsUi.colTransactions}</TableHead>
                <TableHead className="text-right">{t.dailyReportsUi.colCash}</TableHead>
                <TableHead className="text-right">{t.dailyReportsUi.colCard}</TableHead>
                <TableHead className="text-right">{t.dailyReportsUi.colTransfer}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead>{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {t.dailyReportsUi.empty}
                  </TableCell>
                </TableRow>
              ) : (
                filteredReports.map(report => (
                  <TableRow key={report.id}>
                    <TableCell>
                      {format(new Date(report.date), 'dd/MM/yyyy', { locale: dfLocale })}
                    </TableCell>
                    <TableCell>{report.branchName}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(report.totalSales)}
                    </TableCell>
                    <TableCell className="text-right">{report.totalTransactions}</TableCell>
                    <TableCell className="text-right">{formatCurrency(report.cashTotal)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(report.cardTotal)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(report.transferTotal)}</TableCell>
                    <TableCell>
                      <Badge variant={report.status === 'closed' ? 'default' : 'secondary'}>
                        {report.status === 'closed' ? (
                          <><Lock className="w-3 h-3 mr-1" /> {t.dailyReportsUi.statusClosed}</>
                        ) : (
                          t.dailyReportsUi.statusOpen
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => openDetailReport(report.date, report.date, report.branchId, report.branchName)}
                          title={t.dailyReportsUi.viewDetails}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {report.status === 'open' && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => openCloseDialog(report.id, report.cashTotal)}
                          >
                            <Lock className="w-3 h-3 mr-1" />
                            {t.dailyReportsUi.close}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Close Day Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.dailyReportsUi.closeDialogTitle}</DialogTitle>
            <DialogDescription>
              {t.dailyReportsUi.closeDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="closingBalance">{t.dailyReportsUi.closingBalanceLabel}</Label>
              <Input
                id="closingBalance"
                type="number"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">{t.common.notes}</Label>
              <Textarea
                id="notes"
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder={t.dailyReportsUi.closingNotesPlaceholder}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleCloseDay}>
              <Lock className="w-4 h-4 mr-2" />
              {t.dailyReportsUi.confirmClose}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Report Dialog */}
      <DailySalesDetailReport
        open={detailReportOpen}
        onOpenChange={setDetailReportOpen}
        startDate={detailReportStartDate}
        endDate={detailReportEndDate}
        branchId={detailReportBranchId}
        branchName={detailReportBranchName}
      />
    </div>
  );
}
