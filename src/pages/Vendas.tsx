import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSales, useAuth } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { Sale } from '@/types/erp';
import { useTranslation } from '@/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Search, Printer, FileOutput, Eye, RefreshCw, ShoppingCart,
  Calendar, DollarSign, CreditCard, Banknote, ArrowRightLeft,
  Receipt, Check, X, FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { printA4Invoice } from '@/lib/a4Invoice';
import { printReceipt, getPrinterConfig } from '@/lib/thermalPrinter';
import { recordSalePrint } from '@/lib/recordPrintAudit';
import { getCompanySettings } from '@/lib/companySettings';
import { AGTQRCode } from '@/components/invoice/AGTQRCode';
import { toast } from 'sonner';
import { NEXOR_POS_NEW_SALE_NAV_STATE } from '@/lib/nexorPosNewSale';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import { NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';

const paymentLabels: Record<string, { labelKey: 'cash' | 'card' | 'transfer' | 'mixed' | 'credit'; icon: any; color: string }> = {
  cash: { labelKey: 'cash', icon: Banknote, color: 'text-success' },
  card: { labelKey: 'card', icon: CreditCard, color: 'text-info' },
  transfer: { labelKey: 'transfer', icon: ArrowRightLeft, color: 'text-primary' },
  mixed: { labelKey: 'mixed', icon: DollarSign, color: 'text-warning' },
  credit: { labelKey: 'credit', icon: FileText, color: 'text-destructive' },
};

const statusConfig: Record<string, { labelKey: 'completed' | 'voided' | 'pending'; variant: 'default' | 'secondary' | 'destructive' }> = {
  completed: { labelKey: 'completed', variant: 'default' },
  voided: { labelKey: 'voided', variant: 'destructive' },
  pending: { labelKey: 'pending', variant: 'secondary' },
};

export default function Vendas() {
  const navigate = useNavigate();
  const { currentBranch, apiBranchId } = useBranchScope();
  const { sales, refreshSales } = useSales(apiBranchId, { light: false });
  const company = getCompanySettings();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filteredSales = useMemo(() => {
    const sorted = [...sales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (!searchTerm) return sorted;
    const q = searchTerm.toLowerCase();
    return sorted.filter(s =>
      s.invoiceNumber.toLowerCase().includes(q) ||
      (s.customerName && s.customerName.toLowerCase().includes(q)) ||
      (s.customerNif && s.customerNif.includes(q))
    );
  }, [sales, searchTerm]);

  const totals = useMemo(() => ({
    count: filteredSales.length,
    total: filteredSales.filter(s => s.status === 'completed').reduce((sum, s) => sum + s.total, 0),
    cash: filteredSales.filter(s => s.paymentMethod === 'cash' && s.status === 'completed').reduce((sum, s) => sum + s.total, 0),
    card: filteredSales.filter(s => s.paymentMethod === 'card' && s.status === 'completed').reduce((sum, s) => sum + s.total, 0),
  }), [filteredSales]);

  const openDetail = useCallback((sale: Sale) => {
    setSelectedSale(sale);
    setDetailOpen(true);
  }, []);

  useEffect(() => {
    const goPos = () => navigate('/pos');
    const goPosNew = () => navigate('/pos', { state: NEXOR_POS_NEW_SALE_NAV_STATE });
    window.addEventListener(NEXOR_TOOLBAR.POS_CHECKOUT, goPos);
    window.addEventListener(NEXOR_TOOLBAR.POS_VOID, goPosNew);
    return () => {
      window.removeEventListener(NEXOR_TOOLBAR.POS_CHECKOUT, goPos);
      window.removeEventListener(NEXOR_TOOLBAR.POS_VOID, goPosNew);
    };
  }, [navigate]);

  const handleReprintThermal = async (sale: Sale) => {
    if (!currentBranch) return;
    try {
      const config = getPrinterConfig();
      await printReceipt(sale, currentBranch, config, false);
      void recordSalePrint(sale, { format: 'thermal', source: 'vendas', reprint: true });
      toast.success(t.vendasUi.thermalSent);
    } catch {
      toast.error(t.vendasUi.thermalPrintError);
    }
  };

  const handleReprintA4 = async (sale: Sale) => {
    if (!currentBranch) return;
    try {
      await printA4Invoice(sale, currentBranch, { showBankDetails: true, documentType: 'FR' });
      void recordSalePrint(sale, { format: 'a4', source: 'vendas', reprint: true });
      toast.success(t.vendasUi.a4Sent);
    } catch {
      toast.error(t.vendasUi.a4PrintError);
    }
  };

  return (
    <div className="flex flex-col h-full nexor-page-surface">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl gradient-primary">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none">{t.vendasUi.title}</h1>
            <p className="text-xs text-muted-foreground">{currentBranch?.name}</p>
          </div>
        </div>

        <div className="w-px h-8 bg-border mx-2" />

        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => refreshSales()}>
          <RefreshCw className="w-3.5 h-3.5" /> {t.common.refresh}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          onClick={() => navigate('/pos', { state: NEXOR_POS_NEW_SALE_NAV_STATE })}
        >
          <ShoppingCart className="w-3.5 h-3.5" /> {t.topNav.toolbar.newSale}
        </Button>

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder={t.vendasUi.searchPlaceholder}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="h-8 text-xs pl-8 w-64"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 p-3">
        {[
          { label: t.vendasUi.statsTotalSales, value: totals.count, icon: ShoppingCart, gradient: 'gradient-primary' },
          { label: t.vendasUi.statsTotalAmount, value: `${totals.total.toLocaleString(uiLocale)} Kz`, icon: DollarSign, gradient: 'gradient-success' },
          { label: t.vendasUi.payment.cash, value: `${totals.cash.toLocaleString(uiLocale)} Kz`, icon: Banknote, gradient: 'gradient-warm' },
          { label: t.vendasUi.payment.card, value: `${totals.card.toLocaleString(uiLocale)} Kz`, icon: CreditCard, gradient: 'gradient-accent' },
        ].map((stat, i) => (
          <Card key={i} className="nexor-stat-card overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${stat.gradient}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{stat.label}</p>
                  <p className="text-xl font-semibold tracking-tight text-slate-800">{stat.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sales Table */}
      <div className="flex-1 overflow-auto px-3 pb-3">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 border-b sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold w-36">{t.vendasUi.invoiceNo}</th>
              <th className="px-3 py-2 text-left font-semibold w-28">{t.common.date}</th>
              <th className="px-3 py-2 text-left font-semibold w-20">{t.vendasUi.time}</th>
              <th className="px-3 py-2 text-left font-semibold">{t.vendasUi.customer}</th>
              <th className="px-3 py-2 text-left font-semibold w-24">{t.vendasUi.nif}</th>
              <th className="px-3 py-2 text-center font-semibold w-24">{t.vendasUi.paymentHeader}</th>
              <th className="px-3 py-2 text-right font-semibold w-20">{t.vendasUi.items}</th>
              <th className="px-3 py-2 text-right font-semibold w-28">{t.common.total}</th>
              <th className="px-3 py-2 text-center font-semibold w-20">{t.common.status}</th>
              <th className="px-3 py-2 text-center font-semibold w-32">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filteredSales.map(sale => {
              const pay = paymentLabels[sale.paymentMethod] || paymentLabels.cash;
              const status = statusConfig[sale.status] || statusConfig.completed;
              const PayIcon = pay.icon;
              return (
                <tr
                  key={sale.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => openDetail(sale)}
                >
                  <td className="px-3 py-2 font-mono font-medium">{sale.invoiceNumber}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {format(new Date(sale.createdAt), 'dd/MM/yyyy', { locale: dfLocale })}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {format(new Date(sale.createdAt), 'HH:mm', { locale: dfLocale })}
                  </td>
                  <td className="px-3 py-2">{sale.customerName || t.pos.finalConsumer}</td>
                  <td className="px-3 py-2 text-muted-foreground">{sale.customerNif || '999999990'}</td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <PayIcon className={`w-3.5 h-3.5 ${pay.color}`} />
                      <span className="text-[10px]">{t.vendasUi.payment[pay.labelKey]}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{sale.items.length}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">{sale.total.toLocaleString(uiLocale)} Kz</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={status.variant} className="text-[10px] px-1.5 py-0">{t.vendasUi.status[status.labelKey]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(sale)} title={t.vendasUi.viewDetails}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReprintThermal(sale)} title={t.vendasUi.reprintThermal}>
                        <Printer className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReprintA4(sale)} title={t.vendasUi.reprintA4}>
                        <FileOutput className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filteredSales.length > 0 && (
            <tfoot className="bg-muted/80 border-t-2 border-primary/30">
              <tr className="font-bold text-xs">
                <td className="px-3 py-2" colSpan={7}>{t.vendasUi.totalRow.replace('{count}', String(totals.count))}</td>
                <td className="px-3 py-2 text-right font-mono">{totals.total.toLocaleString(uiLocale)} Kz</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>

        {filteredSales.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t.vendasUi.noneFound}</p>
            <p className="text-xs mt-1">{t.vendasUi.noneFoundHint}</p>
          </div>
        )}
      </div>

      {/* Sale Detail Dialog */}
      <SaleDetailDialog
        sale={selectedSale}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        branch={currentBranch}
        company={company}
        onReprintThermal={handleReprintThermal}
        onReprintA4={handleReprintA4}
        t={t}
        uiLocale={uiLocale}
        dfLocale={dfLocale}
      />
    </div>
  );
}

// ============ Sale Detail Dialog ============
function SaleDetailDialog({
  sale, open, onOpenChange, branch, company, onReprintThermal, onReprintA4,
  t, uiLocale, dfLocale,
}: {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: any;
  company: any;
  onReprintThermal: (sale: Sale) => void;
  onReprintA4: (sale: Sale) => void;
  t: any;
  uiLocale: string;
  dfLocale: any;
}) {
  if (!sale) return null;

  const pay = paymentLabels[sale.paymentMethod] || paymentLabels.cash;
  const PayIcon = pay.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            {sale.invoiceNumber}
          </DialogTitle>
        </DialogHeader>

        {/* Receipt-style preview */}
        <div className="bg-white text-black rounded-lg p-4 font-mono text-xs space-y-2 border">
          <div className="text-center space-y-1">
            {company.logo && (
              <div className="flex justify-center mb-2">
                <img src={company.logo} alt={company.tradeName || company.name} className="max-h-12 object-contain" />
              </div>
            )}
            <h3 className="font-bold text-sm">{company.tradeName || company.name}</h3>
            <p>{company.address}</p>
            <p>Tel: {company.phone}</p>
            <p className="text-[10px]">NIF: {company.nif}</p>
          </div>

          <Separator className="border-dashed" />

          <div className="text-center">
            <p className="font-bold">{sale.invoiceNumber}</p>
            <p>{format(new Date(sale.createdAt), t.vendasUi.dateTimePattern, { locale: dfLocale })}</p>
          </div>

          <Separator className="border-dashed" />

          {/* Items */}
          <div className="space-y-1">
            {sale.items.map((item, idx) => (
              <div key={idx} className="flex justify-between">
                <div className="flex-1">
                  <p className="truncate">{item.productName}</p>
                  <p className="text-[10px] text-gray-600">
                    {item.quantity} x {item.unitPrice.toLocaleString(uiLocale)}
                  </p>
                </div>
                <span>{item.subtotal.toLocaleString(uiLocale)}</span>
              </div>
            ))}
          </div>

          <Separator className="border-dashed" />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span>{t.vendasUi.subtotal}</span>
              <span>{sale.subtotal.toLocaleString(uiLocale)} Kz</span>
            </div>
            <div className="flex justify-between">
              <span>{t.vendasUi.vatLabel}</span>
              <span>{sale.taxAmount.toLocaleString(uiLocale)} Kz</span>
            </div>
            <div className="flex justify-between font-bold text-sm">
              <span>{t.common.total}</span>
              <span>{sale.total.toLocaleString(uiLocale)} Kz</span>
            </div>
          </div>

          <Separator className="border-dashed" />

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span>{t.vendasUi.paymentHeader}</span>
              <div className="flex items-center gap-1">
                <PayIcon className={`w-3 h-3 ${pay.color}`} />
                <span>{t.vendasUi.payment[pay.labelKey]}</span>
              </div>
            </div>
            <div className="flex justify-between">
              <span>{t.vendasUi.received}</span>
              <span>{sale.amountPaid.toLocaleString(uiLocale)} Kz</span>
            </div>
            {sale.change > 0 && (
              <div className="flex justify-between font-bold">
                <span>{t.pos.change}</span>
                <span>{sale.change.toLocaleString(uiLocale)} Kz</span>
              </div>
            )}
          </div>

          {(sale.customerNif || sale.customerName) && (
            <>
              <Separator className="border-dashed" />
              <div className="space-y-1">
                {sale.customerName && (
                  <div className="flex justify-between">
                    <span>{t.vendasUi.customer}</span>
                    <span>{sale.customerName}</span>
                  </div>
                )}
                {sale.customerNif && (
                  <div className="flex justify-between">
                    <span>{t.vendasUi.nif}</span>
                    <span>{sale.customerNif}</span>
                  </div>
                )}
              </div>
            </>
          )}

          <Separator className="border-dashed" />

          {branch && (
            <div className="py-2">
              <AGTQRCode sale={sale} branch={branch} size={80} showVerificationText />
            </div>
          )}

          <div className="text-center text-[10px] space-y-1">
            <p>{t.vendasUi.processedBy.replace('{name}', company.tradeName || company.name)}</p>
            <p>{company.footerText || t.vendasUi.thanks}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="outline" onClick={() => onReprintThermal(sale)} className="gap-2">
            <Printer className="w-4 h-4" /> {t.vendasUi.thermalReceipt}
          </Button>
          <Button variant="outline" onClick={() => onReprintA4(sale)} className="gap-2">
            <FileOutput className="w-4 h-4" /> {t.vendasUi.a4Invoice}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
