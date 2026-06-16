import { useState, useRef, useCallback } from 'react';
import { Sale, Branch } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Printer, Settings, Check, FileOutput, ChevronUp, ChevronDown } from 'lucide-react';
import {
  printReceipt,
  getPrinterConfig,
  openCashDrawer,
  POS_RECEIPT_COPY_LABELS,
} from '@/lib/thermalPrinter';
import { PrinterSettingsDialog } from './PrinterSettingsDialog';
import { AGTQRCode } from '@/components/invoice/AGTQRCode';
import { getInvoiceHash } from '@/lib/agtQRCode';
import { printA4Invoice } from '@/lib/a4Invoice';
import { recordSalePrint } from '@/lib/recordPrintAudit';
import { getCompanySettings } from '@/lib/companySettings';
import { toast } from 'sonner';
import { resolveSaleDocumentType } from '@/lib/fiscalInvoiceType';
import { formatTaxLabel, taxRatesFromSaleItems } from '@/lib/taxUtils';
import { useTranslation } from '@/i18n';

interface ReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: Sale | null;
  branch: Branch | null;
  onNewSale: () => void;
}

export function ReceiptDialog({
  open,
  onOpenChange,
  sale,
  branch,
  onNewSale,
}: ReceiptDialogProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const receiptScrollRef = useRef<HTMLDivElement>(null);
  const company = getCompanySettings();
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const taxLabel = sale
    ? formatTaxLabel(taxRatesFromSaleItems(sale.items), t.pos.tax)
    : t.pos.tax;

  const scrollReceipt = useCallback((direction: 'up' | 'down') => {
    const el = receiptScrollRef.current;
    if (!el) return;
    const step = Math.max(120, Math.round(el.clientHeight * 0.65));
    el.scrollBy({ top: direction === 'up' ? -step : step, behavior: 'smooth' });
  }, []);

  if (!sale || !branch) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const config = getPrinterConfig();
      const autoOpenDrawer = localStorage.getItem('kwanza_auto_open_drawer') !== 'false';
      
      const result = await printReceipt(sale, branch, config, {
        openDrawer: autoOpenDrawer,
        copies: POS_RECEIPT_COPY_LABELS.length,
        copyLabels: [...POS_RECEIPT_COPY_LABELS],
      });
      
      if (result.success) {
        void recordSalePrint(sale, { format: 'thermal', source: 'receipt_dialog' });
        toast.success(
          result.method === 'serial' 
            ? t.receiptUi.printThermalSent
            : t.receiptUi.printWindowOpened
        );
      } else {
        toast.error(t.receiptUi.printError);
      }
    } catch (error) {
      toast.error(`${t.receiptUi.printError}: ${(error as Error).message}`);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleOpenDrawer = async () => {
    try {
      const success = await openCashDrawer();
      if (success) {
        toast.success(t.receiptUi.cashDrawerOpened);
      } else {
        toast.info(t.receiptUi.cashDrawerDesktopOnly);
      }
    } catch (error) {
      toast.error(t.receiptUi.cashDrawerError);
    }
  };

  const handlePrintA4 = async () => {
    try {
      await printA4Invoice(sale, branch, {
        showBankDetails: true,
        showNotes: true,
        documentType: resolveSaleDocumentType({
          invoiceType: sale.invoiceType,
          invoiceNumber: sale.invoiceNumber,
        }),
      });
      void recordSalePrint(sale, { format: 'a4', source: 'receipt_dialog' });
      toast.success(t.receiptUi.a4SentToPrint);
    } catch (error) {
      toast.error(t.receiptUi.a4PrintError);
      console.error('A4 print error:', error);
    }
  };

  return (
    <>
      <PrinterSettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen} 
      />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] flex flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-green-600">
            <Check className="w-5 h-5" />
              {t.receiptUi.saleCompleted}
          </DialogTitle>
        </DialogHeader>

        {/* Receipt Preview — scrollable with up/down controls */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={receiptScrollRef}
            className="max-h-[min(52vh,28rem)] overflow-y-auto overflow-x-hidden rounded-lg border bg-white pr-10 scroll-smooth"
          >
            <div className="text-black p-4 font-mono text-xs space-y-2 print:block">
          <div className="text-center space-y-1">
            {company.logo && (
              <div className="flex justify-center mb-2">
                <img src={company.logo} alt={company.tradeName || company.name} className="max-h-12 object-contain" />
              </div>
            )}
            <h3 className="font-bold text-sm">{company.tradeName || company.name}</h3>
            <p>{company.address}</p>
            <p>{company.city}{company.province ? `, ${company.province}` : ''}</p>
            <p>Tel: {company.phone}</p>
            <p className="text-[10px]">NIF: {company.nif}</p>
            <p className="text-[10px] text-gray-500">{branch.name}</p>
          </div>

          <Separator className="border-dashed" />

          <div className="text-center">
            <p className="font-bold">{sale.invoiceNumber}</p>
            <p>{new Date(sale.createdAt).toLocaleString(locale)}</p>
          </div>

          <Separator className="border-dashed" />

          {/* Items */}
          <div className="space-y-1">
            {sale.items.map((item, idx) => (
              <div key={idx} className="flex justify-between">
                <div className="flex-1">
                  <p className="truncate">{item.productName}</p>
                  <p className="text-[10px] text-gray-600">
                    {item.quantity} x {item.unitPrice.toLocaleString(locale)}
                  </p>
                </div>
                <span>{item.subtotal.toLocaleString(locale)}</span>
              </div>
            ))}
          </div>

          <Separator className="border-dashed" />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span>{t.common.subtotal}</span>
              <span>{sale.subtotal.toLocaleString(locale)} Kz</span>
            </div>
            <div className="flex justify-between">
              <span>{taxLabel}</span>
              <span>{sale.taxAmount.toLocaleString(locale)} Kz</span>
            </div>
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span>
              <span>{sale.total.toLocaleString(locale)} Kz</span>
            </div>
            {company.exchangeRateUSD && company.exchangeRateUSD > 0 && (
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Equiv. USD</span>
                <span>$ {(sale.total / company.exchangeRateUSD).toFixed(2)}</span>
              </div>
            )}
            {company.exchangeRateEUR && company.exchangeRateEUR > 0 && (
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Equiv. EUR</span>
                <span>€ {(sale.total / company.exchangeRateEUR).toFixed(2)}</span>
              </div>
            )}
          </div>

          <Separator className="border-dashed" />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span>{t.receiptUi.payment}</span>
              <span className="uppercase">
                {sale.paymentMethod === 'cash'
                  ? t.pos.cash
                  : sale.paymentMethod === 'card'
                    ? t.pos.card
                    : sale.paymentMethod === 'transfer'
                      ? t.pos.transfer
                      : sale.paymentMethod}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t.receiptUi.received}</span>
              <span>{sale.amountPaid.toLocaleString(locale)} Kz</span>
            </div>
            {sale.change > 0 && (
              <div className="flex justify-between font-bold">
                <span>{t.checkoutUi.change}</span>
                <span>{sale.change.toLocaleString(locale)} Kz</span>
              </div>
            )}
          </div>

          {(sale.customerNif || sale.customerName) && (
            <>
              <Separator className="border-dashed" />
              <div className="space-y-1">
                {sale.customerNif && (
                  <div className="flex justify-between">
                    <span>{t.receiptUi.customerNif}</span>
                    <span>{sale.customerNif}</span>
                  </div>
                )}
                {sale.customerName && (
                  <div className="flex justify-between">
                    <span>{t.receiptUi.customer}</span>
                    <span>{sale.customerName}</span>
                  </div>
                )}
              </div>
            </>
          )}

          <Separator className="border-dashed" />

          {/* AGT QR Code - Required by Executive Decree 683/25 */}
          <div className="py-2">
            <AGTQRCode 
              sale={sale} 
              branch={branch} 
              size={100}
              showVerificationText={true}
            />
          </div>

          <Separator className="border-dashed" />

          <div className="text-center text-[10px] space-y-1">
            <p>{t.receiptUi.processedBy.replace('{name}', company.tradeName || company.name)}</p>
            <p>{t.receiptUi.agtCertified}</p>
            <p>{company.footerText || t.receiptUi.thanksDefault}</p>
          </div>
            </div>
          </div>
          <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 print:hidden">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 shadow-sm"
              aria-label={t.receiptUi.scrollUp}
              onClick={() => scrollReceipt('up')}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 shadow-sm"
              aria-label={t.receiptUi.scrollDown}
              onClick={() => scrollReceipt('down')}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 print:hidden shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={handlePrint}
              disabled={isPrinting}
            >
              <Printer className="w-4 h-4 mr-2" />
              {isPrinting ? t.receiptUi.printing : t.receiptUi.thermal}
            </Button>
            <Button variant="outline" onClick={handlePrintA4}>
              <FileOutput className="w-4 h-4 mr-2" />
              A4
            </Button>
          </div>

          <Button className="w-full" onClick={onNewSale}>
            {t.receiptUi.newSale}
          </Button>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="w-4 h-4 mr-2" />
              {t.receiptUi.printerSettings}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
