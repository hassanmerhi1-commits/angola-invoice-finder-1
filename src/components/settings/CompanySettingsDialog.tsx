import { useState, useEffect, useRef } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Building2, 
  Upload, 
  Save, 
  RotateCcw,
  Phone,
  Mail,
  Globe,
  CreditCard,
  FileText,
  Shield,
  DollarSign
} from 'lucide-react';
import {
  CompanySettings,
  getCompanySettings,
  resetCompanySettings,
  fileToBase64,
  validateNIF,
  hydrateCompanySettingsFromServer,
  saveCompanySettingsToServer,
} from '@/lib/companySettings';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

interface CompanySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompanySettingsDialog({
  open,
  onOpenChange,
}: CompanySettingsDialogProps) {
  const { t, language } = useTranslation();
  const locale = language === 'en' ? 'en-US' : 'pt-AO';
  const cs = t.companySettingsUi;
  const [settings, setSettings] = useState<CompanySettings>(() => {
    try {
      return getCompanySettings();
    } catch {
      return {} as CompanySettings;
    }
  });
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    try {
      setSettings(getCompanySettings());
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
    // Pull the latest shared profile from the server so the admin edits current data.
    let cancelled = false;
    void hydrateCompanySettingsFromServer().then((remote) => {
      if (!cancelled && remote) setSettings(remote);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleChange = (field: keyof CompanySettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error(cs.selectImageError);
      return;
    }

    // Validate file size (max 500KB)
    if (file.size > 500 * 1024) {
      toast.error(cs.imageTooLarge);
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      setSettings(prev => ({ ...prev, logo: base64 }));
      toast.success(cs.logoUploaded);
    } catch (error) {
      toast.error(cs.logoUploadError);
    }
  };

  const handleRemoveLogo = () => {
    setSettings(prev => ({ ...prev, logo: undefined }));
  };

  const handleSave = async () => {
    // Validate NIF
    if (!validateNIF(settings.nif)) {
      toast.error(cs.nifInvalid10Digits);
      return;
    }

    setIsSaving(true);
    try {
      // Update exchange rate timestamp if rates changed
      const current = getCompanySettings();
      const ratesChanged = 
        settings.exchangeRateUSD !== current.exchangeRateUSD ||
        settings.exchangeRateEUR !== current.exchangeRateEUR;
      
      const toSave = ratesChanged 
        ? { ...settings, exchangeRateUpdatedAt: new Date().toISOString() }
        : settings;
        
      // Persist to the server (shared) so every LAN client picks it up, and mirror locally.
      await saveCompanySettingsToServer(toSave);
      toast.success(cs.savedSuccess);
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving company settings:', error);
      toast.error(cs.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm(cs.resetConfirm)) {
      const defaultSettings = resetCompanySettings();
      setSettings(defaultSettings);
      toast.info(cs.resetDone);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {cs.title}
          </DialogTitle>
          <DialogDescription>
            {cs.description}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="general">{cs.tabGeneral}</TabsTrigger>
            <TabsTrigger value="contact">{cs.tabContact}</TabsTrigger>
            <TabsTrigger value="fiscal">{cs.tabFiscal}</TabsTrigger>
            <TabsTrigger value="cambio">{cs.tabExchange}</TabsTrigger>
            <TabsTrigger value="branding">{cs.tabBranding}</TabsTrigger>
          </TabsList>

          {/* General Info */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">{cs.legalName}</Label>
                <Input
                  id="name"
                  value={settings.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={cs.legalNamePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tradeName">{cs.tradeName}</Label>
                <Input
                  id="tradeName"
                  value={settings.tradeName || ''}
                  onChange={(e) => handleChange('tradeName', e.target.value)}
                  placeholder={cs.tradeNamePlaceholder}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">{cs.address}</Label>
              <Input
                id="address"
                value={settings.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder={cs.addressPlaceholder}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">{cs.city}</Label>
                <Input
                  id="city"
                  value={settings.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="Luanda"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">{cs.province}</Label>
                <Input
                  id="province"
                  value={settings.province || ''}
                  onChange={(e) => handleChange('province', e.target.value)}
                  placeholder="Luanda"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">{cs.postalCode}</Label>
                <Input
                  id="postalCode"
                  value={settings.postalCode || ''}
                  onChange={(e) => handleChange('postalCode', e.target.value)}
                  placeholder="0000"
                />
              </div>
            </div>
          </TabsContent>

          {/* Contact Info */}
          <TabsContent value="contact" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  {cs.phone}
                </Label>
                <Input
                  id="phone"
                  value={settings.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="+244 923 456 789"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  {t.common.email}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={settings.email || ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="info@empresa.co.ao"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website" className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {cs.website}
              </Label>
              <Input
                id="website"
                value={settings.website || ''}
                onChange={(e) => handleChange('website', e.target.value)}
                placeholder="www.empresa.co.ao"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                {cs.bankDetails}
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bankName">{cs.bank}</Label>
                <Input
                  id="bankName"
                  value={settings.bankName || ''}
                  onChange={(e) => handleChange('bankName', e.target.value)}
                  placeholder="BAI, BFA, etc."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="iban">IBAN</Label>
                <Input
                  id="iban"
                  value={settings.iban || ''}
                  onChange={(e) => handleChange('iban', e.target.value)}
                  placeholder="AO00 0000 0000 0000 0000 0000 0"
                />
              </div>
            </div>
          </TabsContent>

          {/* Fiscal Info */}
          <TabsContent value="fiscal" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="nif" className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                {cs.nifLabel}
              </Label>
              <Input
                id="nif"
                value={settings.nif}
                onChange={(e) => handleChange('nif', e.target.value)}
                placeholder="5000000000"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                {cs.nifHint}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agtCertificateNumber">{cs.agtCertificate}</Label>
                <Input
                  id="agtCertificateNumber"
                  value={settings.agtCertificateNumber || ''}
                  onChange={(e) => handleChange('agtCertificateNumber', e.target.value)}
                  placeholder="SW/AGT/2025/0001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="licenseNumber">{cs.licenseNumber}</Label>
                <Input
                  id="licenseNumber"
                  value={settings.licenseNumber || ''}
                  onChange={(e) => handleChange('licenseNumber', e.target.value)}
                  placeholder="LIC-001-2025"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoicePrefix">{cs.invoicePrefix}</Label>
              <Input
                id="invoicePrefix"
                value={settings.invoicePrefix || ''}
                onChange={(e) => handleChange('invoicePrefix', e.target.value)}
                placeholder="FT"
                maxLength={5}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="invoiceNotes" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                {cs.invoiceNotes}
              </Label>
              <Textarea
                id="invoiceNotes"
                value={settings.invoiceNotes || ''}
                onChange={(e) => handleChange('invoiceNotes', e.target.value)}
                placeholder={cs.invoiceNotesPlaceholder}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="footerText">{cs.footerText}</Label>
              <Input
                id="footerText"
                value={settings.footerText || ''}
                onChange={(e) => handleChange('footerText', e.target.value)}
                placeholder={cs.footerTextPlaceholder}
              />
            </div>
          </TabsContent>

          {/* Exchange Rates / Câmbio */}
          <TabsContent value="cambio" className="space-y-4 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-medium">{cs.exchangeRates}</h3>
                <p className="text-sm text-muted-foreground">
                  {cs.exchangeRatesSubtitle}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="exchangeRateUSD" className="flex items-center gap-2">
                  🇺🇸 {cs.dollarUsd}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">1 USD =</span>
                  <Input
                    id="exchangeRateUSD"
                    type="number"
                    step="0.01"
                    min="0"
                    value={settings.exchangeRateUSD || ''}
                    onChange={(e) => handleChange('exchangeRateUSD', e.target.value)}
                    placeholder="850.00"
                    className="flex-1"
                  />
                  <span className="text-sm font-medium">AOA</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exchangeRateEUR" className="flex items-center gap-2">
                  🇪🇺 {cs.euroEur}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">1 EUR =</span>
                  <Input
                    id="exchangeRateEUR"
                    type="number"
                    step="0.01"
                    min="0"
                    value={settings.exchangeRateEUR || ''}
                    onChange={(e) => handleChange('exchangeRateEUR', e.target.value)}
                    placeholder="920.00"
                    className="flex-1"
                  />
                  <span className="text-sm font-medium">AOA</span>
                </div>
              </div>
            </div>

            {settings.exchangeRateUpdatedAt && (
              <p className="text-xs text-muted-foreground mt-2">
                {cs.lastUpdated}: {new Date(settings.exchangeRateUpdatedAt).toLocaleString(locale)}
              </p>
            )}

            <Separator />

            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">{cs.conversionExample}</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">100 USD =</p>
                  <p className="font-mono font-medium">
                    {settings.exchangeRateUSD 
                      ? `${(100 * Number(settings.exchangeRateUSD)).toLocaleString(locale)} AOA`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">100 EUR =</p>
                  <p className="font-mono font-medium">
                    {settings.exchangeRateEUR 
                      ? `${(100 * Number(settings.exchangeRateEUR)).toLocaleString(locale)} AOA`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Branding */}
          <TabsContent value="branding" className="space-y-4 mt-4">
            <div className="space-y-4">
              <Label>{cs.companyLogo}</Label>
              
              <div className="flex items-center gap-4">
                {settings.logo ? (
                  <div className="relative">
                    <img
                      src={settings.logo}
                      alt="Logo"
                      className="h-20 w-auto object-contain border rounded-lg p-2 bg-white"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full"
                      onClick={handleRemoveLogo}
                    >
                      ×
                    </Button>
                  </div>
                ) : (
                  <div className="h-20 w-32 border-2 border-dashed rounded-lg flex items-center justify-center bg-muted">
                    <span className="text-xs text-muted-foreground">{cs.noLogo}</span>
                  </div>
                )}
                
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {cs.uploadLogo}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {cs.logoHint}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="primaryColor">{cs.primaryColor}</Label>
              <div className="flex gap-2">
                <Input
                  id="primaryColor"
                  type="color"
                  value={settings.primaryColor || '#2563eb'}
                  onChange={(e) => handleChange('primaryColor', e.target.value)}
                  className="w-16 h-10 p-1 cursor-pointer"
                />
                <Input
                  value={settings.primaryColor || '#2563eb'}
                  onChange={(e) => handleChange('primaryColor', e.target.value)}
                  placeholder="#2563eb"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoWidth">{cs.logoWidth}</Label>
              <Input
                id="logoWidth"
                type="number"
                value={settings.logoWidth || 150}
                onChange={(e) => handleChange('logoWidth', e.target.value)}
                min={50}
                max={300}
              />
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        {/* Actions */}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            {cs.resetDefaults}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? cs.saving : t.common.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
