/**
 * SAF-T AO XML validation — official XSD (ASSOFT/AGT) + structural rules.
 * Full schema validation uses xmllint when available on PATH; otherwise structural checks.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { XMLParser } = require('fast-xml-parser');

const NS = 'urn:OECD:StandardAuditFile-Tax:AO_1.01_01';
const XSD_PATH = path.resolve(__dirname, '../../schemas/SAFTAO1.01_01.xsd');

const INVOICE_TYPES = new Set([
  'FT', 'FR', 'GF', 'FG', 'AC', 'AR', 'ND', 'NC', 'AF', 'TV', 'RP', 'RE', 'CS', 'LD', 'RA',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;
const SOFTWARE_VALIDATION_RE = /^(\d+\/AGT\/\d{4}|0)$/;
const NIF_RE = /^\d{10,15}$/;

function resolveXsdPath() {
  if (fs.existsSync(XSD_PATH)) return XSD_PATH;
  const alt = path.join(process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP', 'backend', 'schemas', 'SAFTAO1.01_01.xsd');
  if (fs.existsSync(alt)) return alt;
  return XSD_PATH;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function localName(tag) {
  const s = String(tag || '');
  const idx = s.indexOf(':');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function unwrapAuditFile(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.AuditFile) return parsed.AuditFile;
  for (const key of Object.keys(parsed)) {
    if (localName(key) === 'AuditFile') return parsed[key];
  }
  return null;
}

function pickChild(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[name] !== undefined) return obj[name];
  for (const key of Object.keys(obj)) {
    if (localName(key) === name) return obj[key];
  }
  return undefined;
}

function addIssue(issues, level, code, message, xpath = '') {
  issues.push({ level, code, message, xpath });
}

function validateHeader(header, issues) {
  if (!header) {
    addIssue(issues, 'error', 'header_missing', 'Missing AuditFile.Header');
    return;
  }

  const required = [
    'AuditFileVersion', 'CompanyID', 'TaxRegistrationNumber', 'TaxAccountingBasis',
    'CompanyName', 'CompanyAddress', 'FiscalYear', 'StartDate', 'EndDate',
    'CurrencyCode', 'DateCreated', 'TaxEntity', 'ProductCompanyTaxID',
    'SoftwareValidationNumber', 'ProductID', 'ProductVersion',
  ];

  for (const field of required) {
    const val = pickChild(header, field);
    if (val === undefined || val === null || val === '') {
      addIssue(issues, 'error', 'header_required', `Header.${field} is required`, `Header/${field}`);
    }
  }

  const nif = String(pickChild(header, 'TaxRegistrationNumber') || '').replace(/\D/g, '');
  if (nif && !NIF_RE.test(nif)) {
    addIssue(issues, 'error', 'nif_format', `TaxRegistrationNumber must be 10–15 digits (got ${nif.length})`, 'Header/TaxRegistrationNumber');
  }

  const currency = String(pickChild(header, 'CurrencyCode') || '');
  if (currency && currency !== 'AOA' && currency !== 'USD') {
    addIssue(issues, 'error', 'currency', 'CurrencyCode must be AOA or USD', 'Header/CurrencyCode');
  }

  for (const dateField of ['StartDate', 'EndDate', 'DateCreated']) {
    const d = String(pickChild(header, dateField) || '');
    if (d && !DATE_RE.test(d)) {
      addIssue(issues, 'error', 'date_format', `${dateField} must be YYYY-MM-DD`, `Header/${dateField}`);
    }
  }

  const sw = String(pickChild(header, 'SoftwareValidationNumber') ?? '');
  if (sw && !SOFTWARE_VALIDATION_RE.test(sw)) {
    addIssue(issues, 'error', 'software_validation', 'SoftwareValidationNumber must match NNN/AGT/YYYY or "0"', 'Header/SoftwareValidationNumber');
  }

  if (pickChild(header, 'SoftwareCertificateNumber') !== undefined) {
    addIssue(issues, 'error', 'deprecated_field', 'Use SoftwareValidationNumber, not SoftwareCertificateNumber', 'Header/SoftwareCertificateNumber');
  }
}

function validateInvoice(inv, idx, issues) {
  const base = `SourceDocuments/SalesInvoices/Invoice[${idx}]`;
  const required = [
    'InvoiceNo', 'DocumentStatus', 'Hash', 'HashControl', 'InvoiceDate',
    'InvoiceType', 'SpecialRegimes', 'SourceID', 'SystemEntryDate', 'CustomerID', 'Line', 'DocumentTotals',
  ];
  for (const field of required) {
    if (pickChild(inv, field) === undefined) {
      addIssue(issues, 'error', 'invoice_required', `${field} is required`, `${base}/${field}`);
    }
  }

  const type = String(pickChild(inv, 'InvoiceType') || '');
  if (type === 'FS') {
    addIssue(issues, 'error', 'invoice_type_fs', 'InvoiceType "FS" is not in SAF-T AO XSD — export as FR for simplified invoices', `${base}/InvoiceType`);
  } else if (type && !INVOICE_TYPES.has(type)) {
    addIssue(issues, 'error', 'invoice_type', `Invalid InvoiceType "${type}"`, `${base}/InvoiceType`);
  }

  const invDate = String(pickChild(inv, 'InvoiceDate') || '');
  if (invDate && !DATE_RE.test(invDate)) {
    addIssue(issues, 'error', 'date_format', 'InvoiceDate must be YYYY-MM-DD', `${base}/InvoiceDate`);
  }

  const entryDate = String(pickChild(inv, 'SystemEntryDate') || '');
  if (entryDate && !DATETIME_RE.test(entryDate)) {
    addIssue(issues, 'warn', 'datetime_format', 'SystemEntryDate should be ISO date/time', `${base}/SystemEntryDate`);
  }

  for (const [lineIdx, line] of asArray(pickChild(inv, 'Line')).entries()) {
    for (const lf of ['LineNumber', 'ProductCode', 'ProductDescription', 'Quantity', 'UnitOfMeasure', 'UnitPrice', 'TaxPointDate', 'Description']) {
      if (pickChild(line, lf) === undefined) {
        addIssue(issues, 'error', 'line_required', `Line.${lf} is required`, `${base}/Line[${lineIdx}]/${lf}`);
      }
    }
  }
}

function validateStructureFromXml(xml) {
  const issues = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    addIssue(issues, 'error', 'xml_parse', `XML parse error: ${err.message}`);
    return { ok: false, issues, engine: 'structural' };
  }

  const audit = unwrapAuditFile(parsed);
  if (!audit) {
    addIssue(issues, 'error', 'root', 'Root element AuditFile not found');
    return { ok: false, issues, engine: 'structural' };
  }

  validateHeader(pickChild(audit, 'Header'), issues);

  const sourceDocs = pickChild(audit, 'SourceDocuments');
  const sales = sourceDocs ? pickChild(sourceDocs, 'SalesInvoices') : null;
  if (sales) {
    const declared = Number(pickChild(sales, 'NumberOfEntries') || 0);
    const invoices = asArray(pickChild(sales, 'Invoice'));
    if (declared !== invoices.length) {
      addIssue(issues, 'warn', 'count_mismatch', `NumberOfEntries (${declared}) ≠ Invoice count (${invoices.length})`, 'SourceDocuments/SalesInvoices/NumberOfEntries');
    }
    invoices.forEach((inv, i) => validateInvoice(inv, i + 1, issues));
  }

  if (!pickChild(audit, 'MasterFiles')) {
    addIssue(issues, 'warn', 'master_files', 'MasterFiles section is missing');
  }

  const errors = issues.filter((i) => i.level === 'error');
  return {
    ok: errors.length === 0,
    issues,
    errorCount: errors.length,
    warningCount: issues.filter((i) => i.level === 'warn').length,
    engine: 'structural',
    schemaVersion: '1.01_01',
    xsdPath: resolveXsdPath(),
  };
}

function tryXmllintValidate(xml) {
  const xsd = resolveXsdPath();
  if (!fs.existsSync(xsd)) {
    return null;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexor-saft-'));
  const xmlPath = path.join(tmpDir, 'saft.xml');
  try {
    fs.writeFileSync(xmlPath, xml, 'utf8');
    execFileSync('xmllint', ['--noout', '--schema', xsd, xmlPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, engine: 'xmllint', issues: [], errorCount: 0, warningCount: 0, schemaVersion: '1.01_01', xsdPath: xsd };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    const stderr = String(err.stderr || err.message || '');
    const issues = stderr
      .split(/\r?\n/)
      .filter((line) => /error|valid/i.test(line))
      .slice(0, 30)
      .map((line) => ({ level: 'error', code: 'xsd', message: line.trim(), xpath: '' }));
    if (issues.length === 0) {
      issues.push({ level: 'error', code: 'xsd', message: stderr.trim() || 'XSD validation failed', xpath: '' });
    }
    return {
      ok: false,
      engine: 'xmllint',
      issues,
      errorCount: issues.length,
      warningCount: 0,
      schemaVersion: '1.01_01',
      xsdPath: xsd,
    };
  } finally {
    try {
      fs.unlinkSync(xmlPath);
      fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
}

async function validateSaftXml(xml) {
  if (!xml || typeof xml !== 'string') {
    return {
      ok: false,
      issues: [{ level: 'error', code: 'empty', message: 'Empty XML payload' }],
      errorCount: 1,
      warningCount: 0,
      engine: 'none',
    };
  }

  const trimmed = xml.trim();
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<AuditFile')) {
    return {
      ok: false,
      issues: [{ level: 'error', code: 'xml_root', message: 'Expected XML starting with <?xml or <AuditFile' }],
      errorCount: 1,
      warningCount: 0,
      engine: 'none',
    };
  }

  if (!trimmed.includes(NS)) {
    return {
      ok: false,
      issues: [{ level: 'error', code: 'namespace', message: `Missing namespace ${NS}` }],
      errorCount: 1,
      warningCount: 0,
      engine: 'structural',
    };
  }

  const xmllintResult = tryXmllintValidate(trimmed);
  if (xmllintResult) {
    if (!xmllintResult.ok) return xmllintResult;
    const structural = validateStructureFromXml(trimmed);
    return {
      ...xmllintResult,
      warningCount: structural.warningCount,
      issues: structural.issues.filter((i) => i.level === 'warn'),
    };
  }

  return validateStructureFromXml(trimmed);
}

module.exports = {
  validateSaftXml,
  validateStructureFromXml,
  resolveXsdPath,
  NS,
};
