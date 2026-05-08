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
  RefreshCw,
  DollarSign
} from 'lucide-react';
import {
  CompanySettings,
  getCompanySettings,
  saveCompanySettings,
  resetCompanySettings,
  fileToBase64,
  validateNIF,
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
  const { t } = useTranslation();
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
    if (open) {
      try {
        setSettings(getCompanySettings());
      } catch (error) {
        console.error('Error loading company settings:', error);
      }
    }
  }, [open]);

  const handleChange = (field: keyof CompanySettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor selecione uma imagem');
      return;
    }

    // Validate file size (max 500KB)
    if (file.size > 500 * 1024) {
      toast.error('A imagem deve ter menos de 500KB');
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      setSettings(prev => ({ ...prev, logo: base64 }));
      toast.success('Logo carregado');
    } catch (error) {
      toast.error('Erro ao carregar logo');
    }
  };

  const handleRemoveLogo = () => {
    setSettings(prev => ({ ...prev, logo: undefined }));
  };

  const handleSave = async () => {
    // Validate NIF
    if (!validateNIF(settings.nif)) {
      toast.error(t.companySettingsUi.nifInvalid10Digits);
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
        
      saveCompanySettings(toSave);
      toast.success(t.companySettingsUi.savedSuccess);
      onOpenChange(false);
    } catch (error) {
      toast.error(t.companySettingsUi.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm(t.companySettingsUi.resetConfirm)) {
      const defaultSettings = resetCompanySettings();
      setSettings(defaultSettings);
      toast.info(t.companySettingsUi.resetDone);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Configurações da Empresa
          </DialogTitle>
          <DialogDescription>
            Configure os dados da empresa para facturas e recibos
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="contact">Contacto</TabsTrigger>
            <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
            <TabsTrigger value="cambio">Câmbio</TabsTrigger>
            <TabsTrigger value="branding">Marca</TabsTrigger>
          </TabsList>

          {/* General Info */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome Legal da Empresa *</Label>
                <Input
                  id="name"
                  value={settings.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Empresa, Lda"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tradeName">Nome Comercial</Label>
                <Input
                  id="tradeName"
                  value={settings.tradeName || ''}
                  onChange={(e) => handleChange('tradeName', e.target.value)}
                  placeholder="Nome fantasia"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Morada *</Label>
              <Input
                id="address"
                value={settings.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder={t.companySettingsUi.addressPlaceholder}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">Cidade *</Label>
                <Input
                  id="city"
                  value={settings.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="Luanda"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">Província</Label>
                <Input
                  id="province"
                  value={settings.province || ''}
                  onChange={(e) => handleChange('province', e.target.value)}
                  placeholder="Luanda"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">Código Postal</Label>
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
                  Telefone *
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
                  Email
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
                Website
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
                Dados Bancários
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bankName">Banco</Label>
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
                NIF (Número de Identificação Fiscal) *
              </Label>
              <Input
                id="nif"
                value={settings.nif}
                onChange={(e) => handleChange('nif', e.target.value)}
                placeholder="5000000000"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                O NIF deve ter 10 dígitos
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agtCertificateNumber">Nº Certificado AGT</Label>
                <Input
                  id="agtCertificateNumber"
                  value={settings.agtCertificateNumber || ''}
                  onChange={(e) => handleChange('agtCertificateNumber', e.target.value)}
                  placeholder="SW/AGT/2025/0001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="licenseNumber">Nº Licença</Label>
                <Input
                  id="licenseNumber"
                  value={settings.licenseNumber || ''}
                  onChange={(e) => handleChange('licenseNumber', e.target.value)}
                  placeholder="LIC-001-2025"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoicePrefix">Prefixo de Factura</Label>
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
                Notas da Factura
              </Label>
              <Textarea
                id="invoiceNotes"
                value={settings.invoiceNotes || ''}
                onChange={(e) => handleChange('invoiceNotes', e.target.value)}
                placeholder={t.companySettingsUi.invoiceNotesPlaceholder}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="footerText">Texto do Rodapé</Label>
              <Input
                id="footerText"
                value={settings.footerText || ''}
                onChange={(e) => handleChange('footerText', e.target.value)}
                placeholder={t.companySettingsUi.footerTextPlaceholder}
              />
            </div>
          </TabsContent>

          {/* Exchange Rates / Câmbio */}
          <TabsContent value="cambio" className="space-y-4 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-medium">Taxas de Câmbio</h3>
                <p className="text-sm text-muted-foreground">
                  Configure as taxas de conversão para moedas estrangeiras
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="exchangeRateUSD" className="flex items-center gap-2">
                  🇺🇸 Dólar (USD)
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
                  🇪🇺 Euro (EUR)
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
                Última actualização: {new Date(settings.exchangeRateUpdatedAt).toLocaleString('pt-AO')}
              </p>
            )}

            <Separator />

            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Conversão Exemplo</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">100 USD =</p>
                  <p className="font-mono font-medium">
                    {settings.exchangeRateUSD 
                      ? `${(100 * Number(settings.exchangeRateUSD)).toLocaleString('pt-AO')} AOA`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">100 EUR =</p>
                  <p className="font-mono font-medium">
                    {settings.exchangeRateEUR 
                      ? `${(100 * Number(settings.exchangeRateEUR)).toLocaleString('pt-AO')} AOA`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Branding */}
          <TabsContent value="branding" className="space-y-4 mt-4">
            <div className="space-y-4">
              <Label>Logo da Empresa</Label>
              
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
                    <span className="text-xs text-muted-foreground">Sem logo</span>
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
                    Carregar Logo
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG ou SVG. Máximo 500KB.
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="primaryColor">Cor Principal</Label>
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
              <Label htmlFor="logoWidth">Largura do Logo (px)</Label>
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
            Repor Padrão
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? t.companySettingsUi.saving : t.common.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
