/**
 * AGT Facturação Electrónica (schema 1.2) payload builder.
 * Maps NEXOR sales / NC / ND onto registarFactura.
 */
const { randomUUID } = require('crypto');
const { signJws } = require('./jwsSign');

const PRODUCT_ID = 'NEXOR ERP';
const SCHEMA_VERSION = '1.2';
const FINAL_CONSUMER_TAX_ID = '999999999';
const SIGNATURE_VERSION = 1;

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isoTimestamp(value) {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoDate(value) {
  return isoTimestamp(value).slice(0, 10);
}

function productVersion() {
  try {
    return require('../../package.json').version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/** IVA 14=NOR, 7=INT, 5=RED, 0=ISE. */
function taxCodeForIvaRate(rate) {
  const r = Math.round(Number(rate) || 0);
  if (r === 0) return 'ISE';
  if (r === 5) return 'RED';
  if (r === 7) return 'INT';
  if (r === 14) return 'NOR';
  return 'OUT';
}

/** AGT documentType has no FS — simplified invoices travel as FR. */
function agtDocumentType(nexorType, entityKind) {
  if (entityKind === 'credit_note') return 'NC';
  if (entityKind === 'debit_note') return 'ND';
  const t = String(nexorType || 'FT').toUpperCase();
  if (t === 'FS') return 'FR';
  if (['FT', 'FR', 'NC', 'ND', 'FA', 'FG', 'GF', 'TV'].includes(t)) return t;
  return 'FT';
}

function formatDocumentNo(agtType, invoiceNumber) {
  const raw = String(invoiceNumber || '').trim();
  const type = String(agtType || 'FT').toUpperCase();
  if (!raw) return `${type} 00000001`;
  if (raw.toUpperCase().startsWith(`${type} `)) return raw;
  if (/^(FT|FR|FS|NC|ND)\s+/i.test(raw)) {
    return raw.replace(/^FS\s+/i, 'FR ');
  }
  return `${type} ${raw}`;
}

function customerTaxId(nif) {
  const raw = String(nif || '').trim();
  if (!raw || raw === '999999990' || raw.toUpperCase() === 'CF') return FINAL_CONSUMER_TAX_ID;
  return raw;
}

function buildSoftwareInfoDetail(config) {
  return {
    productId: PRODUCT_ID,
    productVersion: productVersion(),
    softwareValidationNumber: String(config.softwareCertificateNumber || '').trim() || '0',
    signatureVersion: SIGNATURE_VERSION,
  };
}

function buildSoftwareInfo(config, privateKeyPem) {
  const softwareInfoDetail = buildSoftwareInfoDetail(config);
  return {
    softwareInfoDetail,
    jwsSoftwareSignature: signJws(softwareInfoDetail, privateKeyPem),
  };
}

function buildLine(item, index, { isCreditNote }) {
  const qty = Number(item.quantity) || 0;
  const taxRate = Number(item.taxRate != null ? item.taxRate : item.tax_rate) || 0;
  const base = roundMoney(item.subtotal);
  const taxAmount = roundMoney(
    item.taxAmount != null && item.taxAmount !== ''
      ? item.taxAmount
      : item.tax_amount != null
        ? item.tax_amount
        : (base * taxRate) / 100,
  );
  const unitPrice = qty > 0 ? roundMoney(base / qty) : roundMoney(item.unitPrice || item.unit_price || 0);
  const taxCode = taxCodeForIvaRate(taxRate);
  const tax = {
    taxType: 'IVA',
    taxCountryRegion: 'AO',
    taxCode,
    taxPercentage: taxRate,
    taxContribution: taxAmount,
  };
  if (taxCode === 'ISE' && configExemptionCode()) {
    tax.taxExemptionCode = configExemptionCode();
  }
  const line = {
    lineNumber: index + 1,
    productCode: String(item.sku || item.productId || item.product_id || `LN${index + 1}`).slice(0, 60),
    productDescription: String(item.productName || item.product_name || item.description || 'Artigo').slice(0, 200),
    quantity: qty,
    unitOfMeasure: 'UN',
    unitPrice,
    unitPriceBase: unitPrice,
    taxes: [tax],
    settlementAmount: 0,
  };
  if (isCreditNote) {
    line.debitAmount = base;
  } else {
    line.creditAmount = base;
  }
  return line;
}

let exemptionCodeCache = '';
function configExemptionCode() {
  return exemptionCodeCache;
}

function buildDocument({ config, entityKind, doc, items, meta, privateKeyPem }) {
  const agtType = agtDocumentType(doc.invoice_type || doc.invoiceType || meta.docType, entityKind);
  const documentNo = formatDocumentNo(agtType, doc[meta.numberCol]);
  const taxRegistrationNumber = String(config.companyNif || '').trim();
  const documentDate = isoDate(doc[meta.dateCol] || doc.created_at);
  const customerTaxID = customerTaxId(doc.customer_nif);
  const companyName = String(doc.customer_name || 'Consumidor Final').slice(0, 200) || 'Consumidor Final';
  const documentTotals = {
    taxPayable: roundMoney(doc.tax_amount),
    netTotal: roundMoney(doc.subtotal),
    grossTotal: roundMoney(doc.total),
  };
  const signaturePayload = {
    documentNo,
    taxRegistrationNumber,
    documentType: agtType,
    documentDate,
    customerTaxID,
    customerCountry: 'AO',
    companyName,
    documentTotals,
  };
  const isCreditNote = entityKind === 'credit_note';
  const document = {
    documentNo,
    documentStatus: 'N',
    jwsDocumentSignature: signJws(signaturePayload, privateKeyPem),
    documentDate,
    documentType: agtType,
    systemEntryDate: isoTimestamp(doc[meta.dateCol] || doc.created_at),
    customerTaxID,
    customerCountry: 'AO',
    companyName,
    lines: (items || []).map((item, idx) => buildLine(item, idx, { isCreditNote })),
    documentTotals,
  };
  const eac = String(config.eacCode || '').trim();
  if (/^\d{5}$/.test(eac)) document.eacCode = eac;
  return document;
}

function buildRegistarFacturaPayload({ config, entityKind, doc, items, meta, privateKeyPem }) {
  exemptionCodeCache = String(config.ivaExemptionCode || '').trim();
  const documents = [
    buildDocument({ config, entityKind, doc, items, meta, privateKeyPem }),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    submissionUUID: randomUUID(),
    taxRegistrationNumber: String(config.companyNif || '').trim(),
    submissionTimeStamp: isoTimestamp(),
    softwareInfo: buildSoftwareInfo(config, privateKeyPem),
    numberOfEntries: documents.length,
    documents,
  };
}

module.exports = {
  PRODUCT_ID,
  SCHEMA_VERSION,
  FINAL_CONSUMER_TAX_ID,
  roundMoney,
  taxCodeForIvaRate,
  agtDocumentType,
  formatDocumentNo,
  customerTaxId,
  buildSoftwareInfoDetail,
  buildSoftwareInfo,
  buildRegistarFacturaPayload,
};
