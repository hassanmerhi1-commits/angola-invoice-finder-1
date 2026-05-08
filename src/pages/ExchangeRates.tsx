import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, TrendingUp, TrendingDown, ArrowRightLeft, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';

interface ExchangeRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  source: string;
  created_at: string;
}

const CURRENCIES = ['USD', 'EUR', 'ZAR', 'GBP', 'CNY', 'BRL'];

export default function ExchangeRates() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [latestRates, setLatestRates] = useState<ExchangeRate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ from_currency: 'USD', rate: '', effective_date: new Date().toISOString().split('T')[0] });
  const [convertForm, setConvertForm] = useState({ from: 'USD', amount: '100' });
  const [convertResult, setConvertResult] = useState<{ rate: number; converted: number } | null>(null);

  const load = async () => {
    const [allRes, latestRes] = await Promise.all([
      api.exchangeRates.list(50),
      api.exchangeRates.latest(),
    ]);
    if (allRes.data) setRates(allRes.data);
    if (latestRes.data) setLatestRates(latestRes.data);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.rate || parseFloat(form.rate) <= 0) { toast.error(t.exchangeRatesUi.invalidRate); return; }
    const res = await api.exchangeRates.create({
      from_currency: form.from_currency,
      to_currency: 'AOA',
      rate: parseFloat(form.rate),
      effective_date: form.effective_date,
      source: 'manual',
    });
    if (res.data) {
      toast.success(t.exchangeRatesUi.rateAdded);
      setDialogOpen(false);
      setForm({ from_currency: 'USD', rate: '', effective_date: new Date().toISOString().split('T')[0] });
      load();
    }
  };

  const handleDelete = async (id: string) => {
    await api.exchangeRates.delete(id);
    toast.success(t.exchangeRatesUi.rateRemoved);
    load();
  };

  const handleConvert = async () => {
    const res = await api.exchangeRates.convert(convertForm.from, 'AOA', parseFloat(convertForm.amount));
    if (res.data) setConvertResult(res.data);
    else toast.error(t.exchangeRatesUi.noRateAvailable);
  };

  const fmt = (n: number) => n.toLocaleString(uiLocale, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Taxas de Câmbio</h1>
          <p className="text-muted-foreground">{t.exchangeRatesUi.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />{t.common.refresh}</Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />{t.exchangeRatesUi.newRate}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t.exchangeRatesUi.addRateTitle}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t.exchangeRatesUi.currencyLabel}</Label>
                  <Select value={form.from_currency} onValueChange={v => setForm(p => ({ ...p, from_currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t.exchangeRatesUi.rateLabel.replace('{currency}', form.from_currency)}</Label>
                  <Input type="number" step="0.01" value={form.rate} onChange={e => setForm(p => ({ ...p, rate: e.target.value }))} placeholder="835.00" />
                </div>
                <div>
                  <Label>{t.exchangeRatesUi.effectiveDateLabel}</Label>
                  <Input type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreate}>{t.common.save}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Current Rates Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {latestRates.map(r => (
          <Card key={`${r.from_currency}-${r.to_currency}`}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-lg font-mono">{r.from_currency}</Badge>
                  <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-lg font-mono">AOA</Badge>
                </div>
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <p className="text-3xl font-bold mt-3 text-foreground">{fmt(parseFloat(String(r.rate)))}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t.exchangeRatesUi.updatedAt.replace('{date}', new Date(r.effective_date).toLocaleDateString(uiLocale))} • {r.source}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Converter */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t.exchangeRatesUi.quickConverter}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label>{t.exchangeRatesUi.amountLabel}</Label>
              <Input type="number" value={convertForm.amount} onChange={e => setConvertForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="w-32">
              <Label>{t.exchangeRatesUi.currencyLabel}</Label>
              <Select value={convertForm.from} onValueChange={v => setConvertForm(p => ({ ...p, from: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleConvert}>{t.exchangeRatesUi.convert}</Button>
            {convertResult && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{t.exchangeRatesUi.rateValue.replace('{rate}', fmt(convertResult.rate))}</p>
                <p className="text-xl font-bold text-foreground">{fmt(convertResult.converted)} AOA</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* History Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t.exchangeRatesUi.historyTitle}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.exchangeRatesUi.colCurrency}</TableHead>
                <TableHead>{t.exchangeRatesUi.colRate}</TableHead>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{t.exchangeRatesUi.colSource}</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="secondary">{r.from_currency} → {r.to_currency}</Badge>
                  </TableCell>
                  <TableCell className="font-mono font-medium">{fmt(parseFloat(String(r.rate)))}</TableCell>
                  <TableCell>{new Date(r.effective_date).toLocaleDateString(uiLocale)}</TableCell>
                  <TableCell><Badge variant="outline">{r.source}</Badge></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rates.length && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{t.exchangeRatesUi.empty}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
