import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Eraser, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { isDemoMode } from '@/lib/api/config';
import { resetTransactionData } from '@/lib/api/backup';
import { clearLocalErpCache } from '@/lib/clearLocalErpCache';

const CONFIRM_PHRASE = 'APAGAR MOVIMENTOS';

export function TransactionResetCard() {
  const { t } = useTranslation();
  const ui = t.transactionResetUi;
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [postOpeningStock, setPostOpeningStock] = useState(true);
  const [running, setRunning] = useState(false);
  const demo = isDemoMode();

  const confirmed = phrase.trim().toUpperCase() === CONFIRM_PHRASE;

  const handleReset = async () => {
    if (!confirmed) return;
    setRunning(true);
    try {
      const result = await resetTransactionData(phrase.trim(), postOpeningStock);
      const stockTotal = result.openingStock.posted.reduce((sum, p) => sum + p.value, 0);
      let description = ui.doneDescription
        .replace('{count}', String(result.totalDeleted))
        .replace('{backup}', result.backup);
      if (postOpeningStock) {
        description = `${description} ${
          result.openingStock.skipped === 'missing_accounts'
            ? ui.stockSkippedAccounts
            : ui.stockPosted.replace('{value}', stockTotal.toLocaleString('pt-AO', { minimumFractionDigits: 2 }))
        }`;
      }
      toast.success(ui.done, { description, duration: 15000 });
      setOpen(false);
      setPhrase('');
      clearLocalErpCache();
      setTimeout(() => window.location.reload(), 2500);
    } catch (e: unknown) {
      toast.error(ui.failed, { description: e instanceof Error ? e.message : String(e), duration: 15000 });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eraser className="w-5 h-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="font-medium">{ui.clearsLabel}</span> {ui.clearsList}
        </p>
        <p>
          <span className="font-medium">{ui.keepsLabel}</span> {ui.keepsList}
        </p>
        <p className="text-muted-foreground">{ui.beforeHint}</p>
        <Button
          variant="destructive"
          className="w-full gap-2"
          disabled={demo}
          onClick={() => setOpen(true)}
        >
          <Eraser className="w-4 h-4" />
          {ui.openButton}
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => !running && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              {ui.dialogTitle}
            </DialogTitle>
            <DialogDescription>{ui.dialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <Checkbox
                id="reset-opening-stock"
                checked={postOpeningStock}
                onCheckedChange={(v) => setPostOpeningStock(v === true)}
              />
              <Label htmlFor="reset-opening-stock" className="text-sm leading-snug font-normal">
                {ui.openingStockOption}
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm">{ui.typeToConfirm.replace('{phrase}', CONFIRM_PHRASE)}</Label>
              <Input
                id="reset-confirm"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={running} onClick={() => setOpen(false)}>
              {ui.cancel}
            </Button>
            <Button variant="destructive" disabled={!confirmed || running} onClick={handleReset} className="gap-2">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
              {ui.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
