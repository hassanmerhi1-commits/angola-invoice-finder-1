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
  name: '',
  tradeName: '',
  nif: '',
  address: '',
  city: '',
  province: '',
  country: 'Angola',
  phone: '',
  email: '',
  website: '',
  agtCertificateNumber: '',
  softwareVersion: '',
  invoicePrefix: 'FT',
  footerText: '',
  invoiceNotes: '',
  primaryColor: '#2563eb',
  posDefaultPriceLevel: 1,
};

/** Old product placeholders — never treat a real name that merely contains "Kwanza". */
const LEGACY_PLACEHOLDER_NAMES = new Set([
  'kwanza erp',
  'empresa demo',
  'empresa demo lda',
]);

function needsBrandMigration(settings: Partial<CompanySettings>): boolean {
  const name = String(settings.name || '').trim().toLowerCase();
  const trade = String(settings.tradeName || '').trim().toLowerCase();
  return LEGACY_PLACEHOLDER_NAMES.has(name) || LEGACY_PLACEHOLDER_NAMES.has(trade);
}

export function getCompanySettings(): CompanySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<CompanySettings>;
      const migrated = needsBrandMigration(parsed)
        ? {
            ...parsed,
            name: parsed.name && !LEGACY_PLACEHOLDER_NAMES.has(String(parsed.name).trim().toLowerCase())
              ? parsed.name
              : '',
            tradeName: parsed.tradeName && !LEGACY_PLACEHOLDER_NAMES.has(String(parsed.tradeName).trim().toLowerCase())
              ? parsed.tradeName
              : '',
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

/**
 * Overwrite the local cache with the server's shared company profile. Does NOT
 * write back to the server (avoids feedback loops). Fires the update event so
 * logo/receipts/headers refresh immediately.
 */
export function applyServerCompanySettings(remote: Partial<CompanySettings>): CompanySettings {
  const current = getCompanySettings();
  const merged = { ...current, ...remote };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  window.dispatchEvent(new Event('company-settings-updated'));
  return merged;
}

/**
 * apiFetch returns `{ data: <HTTP JSON> }`. Company-settings routes wrap the
 * profile again as `{ data: settings }`, so the real object is at `res.data.data`.
 */
function unwrapCompanySettingsPayload(res: unknown): Partial<CompanySettings> | null {
  const outer = (res as { data?: unknown })?.data;
  if (!outer || typeof outer !== 'object') return null;
  const nested = (outer as { data?: unknown }).data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Partial<CompanySettings>;
  }
  return outer as Partial<CompanySettings>;
}

/**
 * Pull the shared company profile from the server into the local cache. Skips
 * applying when the server row has never been saved (no `updatedAt`), so an
 * unconfigured server can't clobber a correctly-configured client.
 */
export async function hydrateCompanySettingsFromServer(): Promise<CompanySettings | null> {
  try {
    const { api } = await import('@/lib/api/client');
    const res = await api.companySettings.get();
    const data = unwrapCompanySettingsPayload(res);
    if (!data || typeof data !== 'object' || !data.updatedAt) return null;
    return applyServerCompanySettings(data);
  } catch {
    return null;
  }
}

/** Read company settings from the API response (handles nested `{ data }` envelope). */
export function companySettingsFromApiResponse(res: unknown): Partial<CompanySettings> | null {
  return unwrapCompanySettingsPayload(res);
}

/**
 * Persist the company profile to the server (shared across all LAN clients) and
 * mirror it into the local cache. Throws if the server write fails.
 */
export async function saveCompanySettingsToServer(
  settings: Partial<CompanySettings>,
): Promise<CompanySettings> {
  const local = saveCompanySettings(settings);
  const { api } = await import('@/lib/api/client');
  const res = await api.companySettings.save(local as unknown as Record<string, unknown>);
  if ((res as { error?: string })?.error) {
    throw new Error((res as { error?: string }).error);
  }
  return local;
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
