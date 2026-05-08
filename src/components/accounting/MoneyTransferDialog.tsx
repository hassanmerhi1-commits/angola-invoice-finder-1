import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowRight, Banknote, Building2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import {
  getCaixas,
  getBankAccounts,
  executeMoneyTransfer,
} from '@/lib/accountingStorage';
import type { Caixa, BankAccount } from '@/types/accounting';

interface MoneyTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransferComplete?: () => void;
}

type AccountType = 'caixa' | 'bank';

interface AccountOption {
  id: string;
  type: AccountType;
  name: string;
  balance: number;
  status?: string;
}

export function MoneyTransferDialog({
  open,
  onOpenChange,
  onTransferComplete,
}: MoneyTransferDialogProps) {
  const { currentBranch } = useBranchContext();
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  
  const [sourceType, setSourceType] = useState<AccountType>('caixa');
  const [sourceId, setSourceId] = useState<string>('');
  const [destinationType, setDestinationType] = useState<AccountType>('bank');
  const [destinationId, setDestinationId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open && currentBranch) {
      const load = async () => {
        setCaixas(await getCaixas(currentBranch.id));
        setBankAccounts(await getBankAccounts(currentBranch.id));
      };
      load();
    }
  }, [open, currentBranch]);

  const getSourceOptions = (): AccountOption[] => {
    if (sourceType === 'caixa') {
      return caixas
        .filter(c => c.status === 'open')
        .map(c => ({
          id: c.id,
          type: 'caixa' as AccountType,
          name: c.name,
          balance: c.currentBalance,
          status: c.status,
        }));
    }
    return bankAccounts
      .filter(b => b.isActive)
      .map(b => ({
        id: b.id,
        type: 'bank' as AccountType,
        name: `${b.bankName} - ${b.accountNumber}`,
        balance: b.currentBalance,
      }));
  };

  const getDestinationOptions = (): AccountOption[] => {
    const options: AccountOption[] = [];
    
    if (destinationType === 'caixa') {
      caixas.forEach(c => {
        if (!(sourceType === 'caixa' && sourceId === c.id)) {
          options.push({
            id: c.id,
            type: 'caixa',
            name: c.name,
            balance: c.currentBalance,
            status: c.status,
          });
        }
      });
    } else {
      bankAccounts
        .filter(b => b.isActive)
        .forEach(b => {
          if (!(sourceType === 'bank' && sourceId === b.id)) {
            options.push({
              id: b.id,
              type: 'bank',
              name: `${b.bankName} - ${b.accountNumber}`,
              balance: b.currentBalance,
            });
          }
        });
    }
    
    return options;
  };

  const selectedSource = getSourceOptions().find(o => o.id === sourceId);
  const selectedDestination = getDestinationOptions().find(o => o.id === destinationId);
  const amountValue = parseFloat(amount) || 0;
  const isValid = sourceId && destinationId && amountValue > 0 && reason.trim() && 
                  selectedSource && amountValue <= selectedSource.balance;

  const handleSubmit = async () => {
    if (!currentBranch || !user || !isValid) return;
    
    setIsSubmitting(true);
    
    try {
      const result = await executeMoneyTransfer(
        currentBranch.id,
        currentBranch.code,
        sourceType,
        sourceId,
        destinationType,
        destinationId,
        amountValue,
        reason,
        user.id,
        notes || undefined
      );
      
      if (result.success && result.transfer) {
        toast.success(t.moneyTransferUi.doneTitle, {
          description: `${result.transfer.transferNumber}: ${amountValue.toLocaleString(locale)} Kz`,
          icon: '💸',
        });
        
        // Reset form
        setSourceId('');
        setDestinationId('');
        setAmount('');
        setReason('');
        setNotes('');
        
        onTransferComplete?.();
        onOpenChange(false);
      } else {
        toast.error(t.moneyTransferUi.errorTitle, {
          description: result.error || t.moneyTransferUi.errorDefault,
        });
      }
    } catch (error) {
      console.error('Transfer error:', error);
      toast.error(t.moneyTransferUi.errorTitle);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetDestination = () => {
    setDestinationId('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5" />
            {t.moneyTransferUi.title}
          </DialogTitle>
          <DialogDescription>
            {t.moneyTransferUi.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Source Account - CREDIT (money leaves) */}
          <div className="space-y-3 p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                {t.moneyTransferUi.creditBadge}
              </Badge>
              <span className="text-sm text-muted-foreground">{t.moneyTransferUi.sourceHint}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.moneyTransferUi.type}</Label>
                <Select 
                  value={sourceType} 
                  onValueChange={(v) => { 
                    setSourceType(v as AccountType); 
                    setSourceId(''); 
                    resetDestination();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caixa">
                      <div className="flex items-center gap-2">
                        <Banknote className="w-4 h-4" />
                        {t.moneyTransferUi.cash}
                      </div>
                    </SelectItem>
                    <SelectItem value="bank">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        {t.moneyTransferUi.bank}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>{t.moneyTransferUi.account}</Label>
                <Select value={sourceId} onValueChange={(v) => { setSourceId(v); resetDestination(); }}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.moneyTransferUi.select} />
                  </SelectTrigger>
                  <SelectContent>
                    {getSourceOptions().map(option => (
                      <SelectItem key={option.id} value={option.id}>
                        <div className="flex flex-col">
                          <span>{option.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {option.balance.toLocaleString(locale)} Kz
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {selectedSource && (
              <div className="text-sm">
                {t.moneyTransferUi.availableBalance}{' '}
                <strong className="text-red-600">{selectedSource.balance.toLocaleString(locale)} Kz</strong>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ArrowRight className="w-5 h-5" />
              <span className="text-sm font-medium">{t.moneyTransferUi.transferVerb}</span>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>

          {/* Destination Account - DEBIT (money enters) */}
          <div className="space-y-3 p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                {t.moneyTransferUi.debitBadge}
              </Badge>
              <span className="text-sm text-muted-foreground">{t.moneyTransferUi.destinationHint}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.moneyTransferUi.type}</Label>
                <Select 
                  value={destinationType} 
                  onValueChange={(v) => { 
                    setDestinationType(v as AccountType); 
                    setDestinationId(''); 
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caixa">
                      <div className="flex items-center gap-2">
                        <Banknote className="w-4 h-4" />
                        {t.moneyTransferUi.cash}
                      </div>
                    </SelectItem>
                    <SelectItem value="bank">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        {t.moneyTransferUi.bank}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>{t.moneyTransferUi.account}</Label>
                <Select value={destinationId} onValueChange={setDestinationId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.moneyTransferUi.select} />
                  </SelectTrigger>
                  <SelectContent>
                    {getDestinationOptions().map(option => (
                      <SelectItem key={option.id} value={option.id}>
                        <div className="flex flex-col">
                          <span>{option.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {option.balance.toLocaleString(locale)} Kz
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {selectedDestination && (
              <div className="text-sm">
                {t.moneyTransferUi.currentBalance}{' '}
                <strong className="text-green-600">{selectedDestination.balance.toLocaleString(locale)} Kz</strong>
                {amountValue > 0 && (
                  <span className="text-muted-foreground">
                    {' → '}{(selectedDestination.balance + amountValue).toLocaleString(locale)} Kz
                  </span>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Amount */}
          <div className="space-y-2">
            <Label>{t.moneyTransferUi.amountLabel}</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="text-xl h-14 text-center font-bold"
            />
            {selectedSource && amountValue > selectedSource.balance && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4" />
                {t.moneyTransferUi.insufficientBalance}
              </div>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>{t.moneyTransferUi.reasonLabel}</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.moneyTransferUi.reasonPlaceholder}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>{t.moneyTransferUi.notesLabel}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.moneyTransferUi.notesPlaceholder}
              rows={2}
            />
          </div>

          {/* Summary */}
          {isValid && selectedSource && selectedDestination && (
            <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
              <div className="font-medium">{t.moneyTransferUi.summaryTitle}</div>
              <div className="text-muted-foreground">
                <span className="text-red-600">{selectedSource.name}</span>
                {' → '}
                <span className="text-green-600">{selectedDestination.name}</span>
              </div>
              <div className="text-lg font-bold">
                {amountValue.toLocaleString(locale)} Kz
              </div>
            </div>
          )}

          {/* Submit */}
          <Button
            className="w-full h-12"
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
          {isSubmitting ? t.moneyTransferUi.processing : t.moneyTransferUi.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
