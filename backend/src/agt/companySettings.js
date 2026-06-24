/**
 * Server-side company settings for SAF-T header and fiscal exports.
 */
const db = require('../db');
const { getAgtConfig } = require('./agtConfig');
const { readAppVersion } = require('../lib/deploymentStatus');

const SETTINGS_ID = 'default';

const DEFAULTS = {
  name: 'NEXOR ERP',
  tradeName: 'NEXOR ERP',
  nif: '',
  address: '',
  city: 'Luanda',
  province: 'Luanda',
  country: 'Angola',
  phone: '',
  email: '',
  agtCertificateNumber: '',
  softwareVersion: readAppVersion(),
  // Admin-chosen default selling price level (1-4) the POS applies automatically.
  // A selected client's own default price level still overrides this.
  posDefaultPriceLevel: 1,
};

/** Clamp any value to a valid price level (1-4), defaulting to 1. */
function normalizePriceLevel(value) {
  const n = Math.trunc(Number(value));
  return n >= 1 && n <= 4 ? n : 1;
}

function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function getCompanySettingsRow() {
  const res = await db.query('SELECT * FROM company_settings WHERE id = $1', [SETTINGS_ID]).catch(() => ({ rows: [] }));
  return res.rows[0] || null;
}

async function getCompanySettings() {
  const row = await getCompanySettingsRow();
  return { ...DEFAULTS, ...parseJson(row?.settings_json) };
}

async function saveCompanySettings(payload) {
  const merged = { ...(await getCompanySettings()), ...(payload || {}) };
  merged.posDefaultPriceLevel = normalizePriceLevel(merged.posDefaultPriceLevel);
  merged.updatedAt = new Date().toISOString();

  const json = JSON.stringify(merged);
  const existing = await getCompanySettingsRow();
  if (existing) {
    await db.query(
      'UPDATE company_settings SET settings_json = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [json, SETTINGS_ID],
    );
  } else {
    await db.query(
      'INSERT INTO company_settings (id, settings_json) VALUES ($1, $2)',
      [SETTINGS_ID, json],
    );
  }
  return merged;
}

/** Merge DB company settings with AGT config and optional request override. */
async function resolveCompanyForSaft(override) {
  const [stored, agt] = await Promise.all([getCompanySettings(), getAgtConfig()]);
  const merged = {
    ...stored,
    nif: override?.nif || stored.nif || agt.companyNif || '',
    agtCertificateNumber:
      override?.agtCertificateNumber
      || stored.agtCertificateNumber
      || agt.softwareCertificateNumber
      || '',
    name: override?.name || stored.name || stored.tradeName || 'NEXOR ERP',
    softwareVersion: override?.softwareVersion || stored.softwareVersion || readAppVersion(),
  };
  if (override) {
    Object.assign(merged, override);
  }
  return merged;
}

function formatSoftwareValidationNumber(raw) {
  const c = String(raw || '').trim();
  if (!c || c === '0000' || c === '0') return '0';
  if (SOFTWARE_VALIDATION_RE.test(c)) return c;
  const m = c.match(/(\d+)\/AGT\/(\d{4})/i);
  if (m) return `${m[1]}/AGT/${m[2]}`;
  return '0';
}

const SOFTWARE_VALIDATION_RE = /^\d+\/AGT\/\d{4}$/;

function companyToSaftHeader(company, period) {
  const { fiscalYear, start, end } = period;
  const nif = (company.nif || '').replace(/\D/g, '') || '0000000000';
  return {
    AuditFileVersion: '1.01_01',
    CompanyID: nif,
    TaxRegistrationNumber: nif,
    TaxAccountingBasis: 'I',
    CompanyName: company.name || company.tradeName || 'NEXOR ERP',
    BusinessName: company.tradeName || company.name || 'NEXOR ERP',
    CompanyAddress: {
      AddressDetail: company.address || 'N/A',
      City: company.city || 'Luanda',
      PostalCode: company.postalCode || '',
      Country: 'AO',
    },
    FiscalYear: String(fiscalYear),
    StartDate: start,
    EndDate: end,
    CurrencyCode: 'AOA',
    DateCreated: new Date().toISOString().split('T')[0],
    TaxEntity: 'Global',
    ProductCompanyTaxID: nif,
    SoftwareValidationNumber: formatSoftwareValidationNumber(company.agtCertificateNumber),
    ProductID: 'NEXOR ERP',
    ProductVersion: company.softwareVersion || readAppVersion(),
  };
}

module.exports = {
  getCompanySettings,
  saveCompanySettings,
  resolveCompanyForSaft,
  companyToSaftHeader,
};
