import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { 
  Printer, 
  Usb, 
  Globe, 
  Monitor,
  Check,
  AlertCircle
} from 'lucide-react';
import {
  PrinterConfig,
  DEFAULT_PRINTER_CONFIG,
  getPrinterConfig,
  savePrinterConfig,
} from '@/lib/thermalPrinter';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

interface PrinterSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrinterSettingsDialog({
  open,
  onOpenChange,
}: PrinterSettingsDialogProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [hasSerialSupport, setHasSerialSupport] = useState(false);
  const [autoOpenDrawer, setAutoOpenDrawer] = useState(true);

  useEffect(() => {
    if (open) {
      setConfig(getPrinterConfig());
      setHasSerialSupport('serial' in navigator);
      setAutoOpenDrawer(localStorage.getItem('kwanza_auto_open_drawer') !== 'false');
    }
  }, [open]);

  const handleSave = () => {
    savePrinterConfig(config);
    localStorage.setItem('kwanza_auto_open_drawer', autoOpenDrawer.toString());
    toast.success(t.printerUi.saved);
    onOpenChange(false);
  };

  const handleTestPrint = async () => {
    try {
      if (config.type === 'usb' && hasSerialSupport) {
        // Request port access to test
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate: 9600 });
        
        // Send test text
        const encoder = new TextEncoder();
        const testData = encoder.encode(
          '\x1B@' + // Initialize
          '\x1Ba\x01' + // Center
          'TESTE DE IMPRESSAO\n' +
          'KWANZA ERP\n' +
          '------------------------\n' +
          'Impressora configurada!\n\n\n' +
          '\x1DVA' // Cut
        );
        
        const writer = port.writable.getWriter();
        await writer.write(testData);
        writer.releaseLock();
        await port.close();
        
        toast.success('Teste enviado para a impressora');
      } else {
        // Browser print test
        const printWindow = window.open('', '_blank', 'width=400,height=300');
        if (printWindow) {
          printWindow.document.write(`
            <html>
            <head>
              <style>
                body { font-family: monospace; text-align: center; padding: 20px; }
              </style>
            </head>
            <body>
              <h2>TESTE DE IMPRESSÃO</h2>
              <p>KWANZA ERP</p>
              <hr>
              <p>Impressora configurada!</p>
            </body>
            </html>
          `);
          printWindow.document.close();
          printWindow.print();
        }
        toast.success(t.printerUi.testWindowOpened);
      }
    } catch (error) {
      toast.error(t.printerUi.testError.replace('{message}', (error as Error).message));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5" />
            {t.printerUi.title}
          </DialogTitle>
          <DialogDescription>
            {t.printerUi.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Connection Type */}
          <div className="space-y-3">
            <Label>{t.printerUi.connectionType}</Label>
            <RadioGroup
              value={config.type}
              onValueChange={(v) => setConfig({ ...config, type: v as PrinterConfig['type'] })}
              className="grid grid-cols-2 gap-3"
            >
              <div>
                <RadioGroupItem value="browser" id="browser" className="peer sr-only" />
                <Label
                  htmlFor="browser"
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                >
                  <Monitor className="mb-2 h-6 w-6" />
                  <span className="text-sm font-medium">{t.printerUi.browser}</span>
                  <span className="text-xs text-muted-foreground">{t.printerUi.normalPrint}</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem 
                  value="usb" 
                  id="usb" 
                  className="peer sr-only" 
                  disabled={!hasSerialSupport}
                />
                <Label
                  htmlFor="usb"
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary ${
                    hasSerialSupport ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Usb className="mb-2 h-6 w-6" />
                  <span className="text-sm font-medium">{t.printerUi.usbThermal}</span>
                  <span className="text-xs text-muted-foreground">
                    {hasSerialSupport ? t.printerUi.directEscPos : t.printerUi.notSupported}
                  </span>
                </Label>
              </div>
            </RadioGroup>
            
            {!hasSerialSupport && config.type === 'browser' && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg text-sm text-amber-700">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{t.printerUi.usbWarning}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Paper Width */}
          <div className="space-y-3">
            <Label>{t.printerUi.paperWidth}</Label>
            <RadioGroup
              value={config.paperWidth.toString()}
              onValueChange={(v) => setConfig({ 
                ...config, 
                paperWidth: parseInt(v) as 58 | 80,
                characterWidth: v === '80' ? 48 : 32
              })}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="80" id="80mm" />
                <Label htmlFor="80mm" className="cursor-pointer">{t.printerUi.default80}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="58" id="58mm" />
                <Label htmlFor="58mm" className="cursor-pointer">{t.printerUi.mini58}</Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {/* Auto open drawer */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t.printerUi.autoOpenDrawer}</Label>
              <p className="text-xs text-muted-foreground">
                {t.printerUi.autoOpenDrawerDesc}
              </p>
            </div>
            <Switch
              checked={autoOpenDrawer}
              onCheckedChange={setAutoOpenDrawer}
            />
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleTestPrint} className="flex-1">
              <Printer className="w-4 h-4 mr-2" />
              {t.printerUi.test}
            </Button>
            <Button onClick={handleSave} className="flex-1">
              <Check className="w-4 h-4 mr-2" />
              {t.printerUi.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
