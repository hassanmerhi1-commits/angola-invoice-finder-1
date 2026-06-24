/**
 * Company Settings Management for NEXOR ERP
 * Stores company information for invoices and receipts
 */

export interface CompanySettings {
  // Basic Info
  name: string;
  tradeName?: string; // Nome comercial
  nif: string;
  
  // Address
  address: string;
  city: string;
  province: string;
  postalCode?: string;
  country: string;
  
  // Contact
  phone: string;
  email?: string;
  website?: string;
  
  // Banking
  bankName?: string;
  iban?: string;
  
  // Branding
  logo?: string; // Base64 or URL
  logoWidth?: number;
  primaryColor?: string;
  
  // AGT / Fiscal
  agtCertificateNumber?: string;
  softwareVersion?: string;
  licenseNumber?: string;
  
  // Invoice Settings
  invoicePrefix?: string;
  invoiceNotes?: string;
  footerText?: string;

  // POS — admin-chosen default selling price level (1-4) applied automatically.
  // A selected client's own default price level still overrides this.
  posDefaultPriceLevel?: number;
  
  // Exchange Rates (Câmbio)
  exchangeRateUSD?: number; // 1 USD = X AOA
  exchangeRateEUR?: number; // 1 EUR = X AOA
  exchangeRateUpdatedAt?: string;
  
  createdAt?: string;
  updatedAt?: string;
}

const STORAGE_KEY = 'kwanza_company_settings';

const DEFAULT_SETTINGS: CompanySettings = {
  name: 'NEXOR ERP',
  tradeName: 'NEXOR ERP',
  nif: '5000000000',
  address: 'Rua Comandante Gika, 123',
  city: 'Luanda',
  province: 'Luanda',
  country: 'Angola',
  phone: '+244 923 456 789',
  email: 'info@nexorerp.co.ao',
  website: 'www.nexorerp.co.ao',
  agtCertificateNumber: 'SW/AGT/2025/0001',
  softwareVersion: '1.0.0',
  invoicePrefix: 'FT',
  footerText: 'Obrigado pela preferência!',
  invoiceNotes: 'Pagamento a pronto. Não aceitamos devoluções após 7 dias.',
  primaryColor: '#2563eb',
  posDefaultPriceLevel: 1,
};

function needsBrandMigration(settings: Partial<CompanySettings>): boolean {
  const brandFields = [settings.name, settings.tradeName, settings.email, settings.website]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return brandFields.includes('kwanza') || brandFields.includes('empresa demo');
}

export function getCompanySettings(): CompanySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<CompanySettings>;
      const migrated = needsBrandMigration(parsed)
        ? {
            ...parsed,
            name: 'NEXOR ERP',
            tradeName: 'NEXOR ERP',
            email: parsed.email && !parsed.email.includes('empresa.') ? parsed.email : DEFAULT_SETTINGS.email,
            website: parsed.website && !parsed.website.includes('empresa.') ? parsed.website : DEFAULT_SETTINGS.website,
          }
        : parsed;

      const merged = { ...DEFAULT_SETTINGS, ...migrated };

      if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }

      return merged;
    }
  } catch (error) {
    console.error('Error loading company settings:', error);
  }
  return DEFAULT_SETTINGS;
}

export function saveCompanySettings(settings: Partial<CompanySettings>): CompanySettings {
  try {
    const current = getCompanySettings();
    const updated = {
      ...current,
      ...settings,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('company-settings-updated'));
    return updated;
  } catch (error) {
    console.error('Error saving company settings:', error);
    throw error;
  }
}

export function resetCompanySettings(): CompanySettings {
  localStorage.removeItem(STORAGE_KEY);
  return DEFAULT_SETTINGS;
}

// Convert file to base64 for logo storage
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

/**
 * AGT-mandated software-validation phrase printed on every fiscal document, e.g.
 * "Processado por programa validado n.º 123/AGT/2025". Uses the company's AGT
 * certificate/validation number when available.
 */
export function softwareValidationLine(settings?: Pick<CompanySettings, 'agtCertificateNumber'>): string {
  const number = (settings?.agtCertificateNumber || getCompanySettings().agtCertificateNumber || '').trim();
  if (!number) {
    return 'Processado por programa validado pela AGT';
  }
  return `Processado por programa validado n.º ${number}`;
}

// Validate NIF format (Angola uses 10-digit NIFs)
export function validateNIF(nif: string): boolean {
  const cleaned = nif.replace(/\D/g, '');
  return cleaned.length === 10;
}
