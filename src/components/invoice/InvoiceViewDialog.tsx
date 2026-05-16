import { Sale, Branch } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  Printer, 
  Download, 
  FileText, 
  Receipt,
  FileOutput
} from 'lucide-react';
import { AGTQRCode } from './AGTQRCode';
import { getInvoiceHash } from '@/lib/agtQRCode';
import { printViaBrowser, getPrinterConfig } from '@/lib/thermalPrinter';
import { printA4Invoice } from '@/lib/a4Invoice';
import { getCompanySettings } from '@/lib/companySettings';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

interface InvoiceViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: Sale | null;
  branch: Branch | null;
}

export function InvoiceViewDialog({
  open,
  onOpenChange,
  sale,
  branch,
}: InvoiceViewDialogProps) {
  const { t, language } = useTranslation();
  const iv = t.invoiceViewUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  if (!sale || !branch) return null;

  const company = getCompanySettings();

  const handlePrintThermal = () => {
    const config = getPrinterConfig();
    printViaBrowser(sale, branch, config.paperWidth);
    toast.success(iv.thermalSent);
  };

  const handlePrintA4 = async () => {
    try {
      await printA4Invoice(sale, branch, {
        showBankDetails: true,
        showNotes: true,
        documentType: 'FR',
      });
      toast.success(iv.a4Sent);
    } catch (error) {
      toast.error(iv.printError);
      console.error('Print error:', error);
    }
  };

  const handleDownloadPDF = async () => {
    await handlePrintA4();
    toast.info(iv.saveAsPdfHint);
  };

  const paymentMethodLabels: Record<string, string> = {
    cash: iv.paymentCash,
    card: iv.paymentCard,
    transfer: iv.paymentTransfer,
    mixed: iv.paymentMixed,
  };

  const agtStatusLabel =
    sale.agtStatus === 'validated'
      ? iv.agtValidated
      : sale.agtStatus === 'rejected'
        ? iv.agtRejected
        : iv.agtPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {iv.title} {sale.invoiceNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="bg-white text-black rounded-lg border shadow-sm">
          <div className="p-6 border-b">
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-4">
                {company.logo && (
                  <img 
                    src={company.logo} 
                    alt="Logo" 
                    className="h-16 w-auto object-contain"
                  />
                )}
                <div>
                  <h2 className="text-xl font-bold">{company.name}</h2>
                  {company.tradeName && (
                    <p className="text-sm text-gray-500">{company.tradeName}</p>
                  )}
                  <p className="text-sm text-gray-600">{company.address}</p>
                  <p className="text-sm text-gray-600">{company.city}, {company.province}</p>
                  <p className="text-sm text-gray-600">Tel: {company.phone}</p>
                  <p className="text-sm font-medium">NIF: {company.nif}</p>
                </div>
              </div>
              <div className="text-right">
                <Badge variant={sale.status === 'completed' ? 'default' : 'destructive'}>
                  {sale.status === 'completed' ? iv.issued : iv.voided}
                </Badge>
                <p className="mt-2 text-lg font-bold">{sale.invoiceNumber}</p>
                <p className="text-sm text-gray-600">
                  {new Date(sale.createdAt).toLocaleDateString(locale)}
                </p>
                <p className="text-xs text-gray-500">
                  {new Date(sale.createdAt).toLocaleTimeString(locale)}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 border-b">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">{iv.customer}</p>
                <p className="font-medium">{sale.customerName || iv.finalConsumer}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{iv.customerNif}</p>
                <p className="font-medium">{sale.customerNif || '999999990'}</p>
              </div>
            </div>
          </div>

          <div className="p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">{iv.colDescription}</th>
                  <th className="text-center py-2">{iv.colQty}</th>
                  <th className="text-right py-2">{iv.colUnitPrice}</th>
                  <th className="text-right py-2">{iv.colVat}</th>
                  <th className="text-right py-2">{iv.colSubtotal}</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-dashed">
                    <td className="py-2">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-xs text-gray-500">SKU: {item.productId.slice(0, 8)}</p>
                    </td>
                    <td className="text-center py-2">{item.quantity}</td>
                    <td className="text-right py-2">
                      {item.unitPrice.toLocaleString(locale)} Kz
                    </td>
                    <td className="text-right py-2">14%</td>
                    <td className="text-right py-2 font-medium">
                      {item.subtotal.toLocaleString(locale)} Kz
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-gray-50 border-t">
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{iv.subtotalExVat}</span>
                  <span>{sale.subtotal.toLocaleString(locale)} Kz</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{iv.vat14}</span>
                  <span>{sale.taxAmount.toLocaleString(locale)} Kz</span>
                </div>
                {sale.discount > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>{iv.discount}</span>
                    <span>-{sale.discount.toLocaleString(locale)} Kz</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>{iv.total}</span>
                  <span>{sale.total.toLocaleString(locale)} Kz</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500">{iv.paymentMethod}</p>
                <p className="font-medium">{paymentMethodLabels[sale.paymentMethod]}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{iv.amountReceived}</p>
                <p className="font-medium">{sale.amountPaid.toLocaleString(locale)} Kz</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{iv.change}</p>
                <p className="font-medium">{sale.change.toLocaleString(locale)} Kz</p>
              </div>
            </div>
          </div>

          <div className="p-4 border-t bg-gray-50">
            <div className="flex items-start gap-6">
              <AGTQRCode 
                sale={sale} 
                branch={branch} 
                size={120}
                showVerificationText={true}
              />
              <div className="flex-1 text-xs text-gray-600 space-y-1">
                <p><strong>{iv.fiscalInfo}</strong></p>
                <p>Hash: {getInvoiceHash(sale)}</p>
                <p>{iv.docTypeFr}</p>
                <p>{iv.agtCertifiedSoftware}</p>
                {sale.agtCode && <p>CUCE: {sale.agtCode}</p>}
                {sale.agtStatus && (
                  <p>
                    {iv.agtStatus}{' '}
                    <Badge variant={sale.agtStatus === 'validated' ? 'default' : 'secondary'}>
                      {agtStatusLabel}
                    </Badge>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 border-t text-center text-xs text-gray-500">
            <p>{iv.agtFooterCertified.replace('{name}', company.tradeName || company.name || 'NEXOR ERP')}</p>
            <p className="mt-1">{iv.agtFooterDisclaimer}</p>
          </div>
        </div>

        <div className="space-y-2 pt-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrintA4} className="flex-1">
              <FileOutput className="w-4 h-4 mr-2" />
              {iv.printA4}
            </Button>
            <Button variant="outline" onClick={handlePrintThermal} className="flex-1">
              <Receipt className="w-4 h-4 mr-2" />
              {iv.thermalReceipt}
            </Button>
          </div>
          <Button variant="outline" onClick={handleDownloadPDF} className="w-full">
            <Download className="w-4 h-4 mr-2" />
            {iv.saveAsPdf}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
