import { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { getCompanySettings, saveCompanySettings } from '@/lib/companySettings';
import { normalizePriceLevel, PRICE_LEVELS } from '@/lib/pricing';

/**
 * Lets an admin pick the default selling price level the POS applies to every sale.
 * Stored server-side (company settings) so it propagates to all terminals; cashiers
 * cannot override it at the POS. A client's own default price level still wins.
 */
export function PosPricingSettingsCard() {
  const { t } = useTranslation();
  const [level, setLevel] = useState<number>(() =>
    normalizePriceLevel(getCompanySettings().posDefaultPriceLevel ?? 1),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.companySettings
      .get()
      .then((res) => {
        if (cancelled) return;
        setLevel(normalizePriceLevel(res?.data?.posDefaultPriceLevel ?? 1));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (value: string) => {
    const next = normalizePriceLevel(Number(value));
    const previous = level;
    setLevel(next);
    setSaving(true);
    try {
      await api.companySettings.save({ posDefaultPriceLevel: next });
      saveCompanySettings({ posDefaultPriceLevel: next });
      toast.success(t.settingsPage.posPricing.saved);
    } catch {
      setLevel(previous);
      toast.error(t.settingsPage.posPricing.saveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-5 w-5" />
          {t.settingsPage.posPricing.title}
        </CardTitle>
        <CardDescription>{t.settingsPage.posPricing.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>{t.settingsPage.posPricing.defaultLevelLabel}</Label>
            <p className="text-xs text-muted-foreground">{t.settingsPage.posPricing.defaultLevelHint}</p>
          </div>
          <Select value={String(level)} onValueChange={handleChange} disabled={saving}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRICE_LEVELS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t.posUi.priceLevelOption.replace('{n}', String(n))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
