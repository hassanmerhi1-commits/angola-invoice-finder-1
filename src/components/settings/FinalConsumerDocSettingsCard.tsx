import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import {
  companySettingsFromApiResponse,
  saveCompanySettings,
} from '@/lib/companySettings';
import {
  fsMaxAmount,
  getFinalConsumerDocType,
  normalizeFinalConsumerDocType,
  type FinalConsumerDocType,
} from '@/lib/fiscalInvoiceType';

/**
 * Admin choice of FS vs TV for paid final-consumer sales under the FS limit.
 * Stored in server company settings; the backend picks the type and number.
 */
export function FinalConsumerDocSettingsCard() {
  const { t, language } = useTranslation();
  const ui = t.settingsPage.finalConsumerDoc;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [docType, setDocType] = useState<FinalConsumerDocType>(() => getFinalConsumerDocType());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.companySettings
      .get()
      .then((res) => {
        if (cancelled) return;
        const remote = companySettingsFromApiResponse(res);
        if (remote) setDocType(normalizeFinalConsumerDocType(remote.finalConsumerDocType));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (value: string) => {
    const next = normalizeFinalConsumerDocType(value);
    const previous = docType;
    setDocType(next);
    setSaving(true);
    try {
      const res = await api.companySettings.save({ finalConsumerDocType: next });
      if ((res as { error?: string })?.error) throw new Error((res as { error?: string }).error);
      saveCompanySettings({ finalConsumerDocType: next });
      toast.success(ui.saved);
    } catch {
      setDocType(previous);
      toast.error(ui.saveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>
          {ui.description.replace('{max}', fsMaxAmount().toLocaleString(locale))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>{ui.label}</Label>
            <p className="text-xs text-muted-foreground">{ui.hint}</p>
          </div>
          <Select value={docType} onValueChange={handleChange} disabled={saving}>
            <SelectTrigger className="h-9 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FS">{ui.optionFs}</SelectItem>
              <SelectItem value="TV">{ui.optionTv}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
