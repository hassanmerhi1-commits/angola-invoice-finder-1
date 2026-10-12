/**
 * AGT Facturação Electrónica (schema 2.0) payload builder.
 * Maps NEXOR sales / NC / ND onto registarFactura.
 * Spec: https://portaldoparceiro.minfin.gov.ao/doc-agt/faturacao-electronica/1/servicos/registar.html
 */
const { randomUUID } = require('crypto');
const { signJws } = require('./jwsSign');

const PRODUCT_ID = 'NEXOR ERP';
const SCHEMA_VERSION = '2.0';
const FINAL_CONSUMER_TAX_ID = '999999999';
const SIGNATURE_VERSION = 1;
/** TB = transmissão de bens; SG = prestação de serviço (geral). Products carry no service flag. */
const OPERATION_TYPE_GOODS = 'TB';
const OPERATION_TYPE_SERVICE = 'SG';

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** taxContribution must be rounded up to the next cêntimo (23,144 → 23,15; 5,9999999 → 6,00). */
function ceilCent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(Number((n * 100).toFixed(6))) / 100;
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
  if (/^(FT|FR|FS|TV|NC|ND)\s+/i.test(raw)) {
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

/**
 * softwareInfo is signed with NEXOR's producer key (public half registered on the Partner Portal);
 * documents and request signatures use the taxpayer key AGT issues to the company.
 */
function buildSoftwareInfo(config, softwarePrivateKeyPem) {
  const softwareInfoDetail = buildSoftwareInfoDetail(config);
  return {
    softwareInfoDetail,
    jwsSoftwareSignature: signJws(softwareInfoDetail, softwarePrivateKeyPem),
  };
}

function buildLine(item, index, { isCreditNote, operationType, referenceInfo }) {
  const qty = Number(item.quantity) || 0;
  const taxRate = Number(item.taxRate != null ? item.taxRate : item.tax_rate) || 0;
  const base = roundMoney(item.subtotal);
  const unitPrice = qty > 0 ? roundMoney(base / qty) : roundMoney(item.unitPrice || item.unit_price || 0);
  // unitPriceBase = list price before line/header discounts; the difference travels as settlementAmount.
  const listPrice = roundMoney(item.unitPrice != null ? item.unitPrice : item.unit_price);
  const unitPriceBase = listPrice > unitPrice && qty > 0 ? listPrice : unitPrice;
  const settlementAmount = Math.max(0, roundMoney(unitPriceBase * qty - base));
  const taxCode = taxCodeForIvaRate(taxRate);
  const tax = {
    taxType: 'IVA',
    taxCountryRegion: 'AO',
    taxCode,
    taxPercentage: taxRate,
    taxContribution: ceilCent((base * taxRate) / 100),
  };
  if (taxCode === 'ISE' && configExemptionCode()) {
    tax.taxExemptionCode = configExemptionCode();
  }
  const line = {
    lineNumber: index + 1,
    operationType,
    productCode: String(item.sku || item.productId || item.product_id || `LN${index + 1}`).slice(0, 60),
    productDescription: String(item.productName || item.product_name || item.description || 'Artigo').slice(0, 200),
    quantity: qty,
    unitOfMeasure: 'UN',
    unitPrice,
    unitPriceBase,
    taxes: [tax],
    settlementAmount,
  };
  if (referenceInfo) line.referenceInfo = referenceInfo;
  if (isCreditNote) {
    line.debitAmount = base;
  } else {
    line.creditAmount = base;
  }
  return line;
}

/** NC (and ND when known) must point at the invoice they correct. */
function buildReferenceInfo(entityKind, doc) {
  if (entityKind !== 'credit_note' && entityKind !== 'debit_note') return null;
  const originalNumber = String(doc.original_invoice_number || '').trim();
  if (!originalNumber) return null;
  const originalType = agtDocumentType(doc.original_invoice_type || 'FT', 'sale');
  const info = { reference: formatDocumentNo(originalType, originalNumber).slice(0, 60) };
  const reason = String(doc.reason_description || doc.reason || '').trim();
  if (reason) info.reason = reason.slice(0, 60);
  return info;
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
  const isCreditNote = entityKind === 'credit_note';
  const lines = (items || []).map((item, idx) => buildLine(item, idx, {
    isCreditNote,
    operationType: entityKind === 'debit_note' ? OPERATION_TYPE_SERVICE : OPERATION_TYPE_GOODS,
    referenceInfo: buildReferenceInfo(entityKind, doc),
  }));
  // AGT checks taxPayable / netTotal / grossTotal against the lines (E22–E24), so derive them
  // from the lines; fall back to the header only for documents without lines.
  const documentTotals = lines.length
    ? (() => {
      const netTotal = roundMoney(lines.reduce((s, l) => s + (l.creditAmount ?? l.debitAmount ?? 0), 0));
      const taxPayable = roundMoney(lines.reduce((s, l) => s + l.taxes.reduce((t, x) => t + x.taxContribution, 0), 0));
      return { taxPayable, netTotal, grossTotal: roundMoney(netTotal + taxPayable) };
    })()
    : {
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
    lines,
    documentTotals,
  };
  const eac = String(config.eacCode || '').trim();
  if (/^\d{5}$/.test(eac)) document.eacCode = eac;
  return document;
}

/**
 * @param {object} args
 * @param {string} args.privateKeyPem taxpayer key (AGT-issued) — signs documents
 * @param {string} [args.softwarePrivateKeyPem] NEXOR producer key — signs softwareInfo
 */
function buildRegistarFacturaPayload({ config, entityKind, doc, items, meta, privateKeyPem, softwarePrivateKeyPem }) {
  exemptionCodeCache = String(config.ivaExemptionCode || '').trim();
  const documents = [
    buildDocument({ config, entityKind, doc, items, meta, privateKeyPem }),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    submissionUUID: randomUUID(),
    taxRegistrationNumber: String(config.companyNif || '').trim(),
    submissionTimeStamp: isoTimestamp(),
    softwareInfo: buildSoftwareInfo(config, softwarePrivateKeyPem || privateKeyPem),
    numberOfEntries: documents.length,
    documents,
  };
}

/** obterEstado request — jwsSignature covers { taxRegistrationNumber, requestID }. */
function buildObterEstadoPayload({ config, requestId, privateKeyPem, softwarePrivateKeyPem }) {
  const taxRegistrationNumber = String(config.companyNif || '').trim();
  const requestID = String(requestId || '').trim();
  return {
    schemaVersion: SCHEMA_VERSION,
    submissionUUID: randomUUID(),
    taxRegistrationNumber,
    submissionTimeStamp: isoTimestamp(),
    softwareInfo: buildSoftwareInfo(config, softwarePrivateKeyPem || privateKeyPem),
    jwsSignature: signJws({ taxRegistrationNumber, requestID }, privateKeyPem),
    requestID,
  };
}

module.exports = {
  PRODUCT_ID,
  SCHEMA_VERSION,
  FINAL_CONSUMER_TAX_ID,
  OPERATION_TYPE_GOODS,
  OPERATION_TYPE_SERVICE,
  roundMoney,
  ceilCent,
  buildReferenceInfo,
  buildObterEstadoPayload,
  taxCodeForIvaRate,
  agtDocumentType,
  formatDocumentNo,
  customerTaxId,
  buildSoftwareInfoDetail,
  buildSoftwareInfo,
  buildRegistarFacturaPayload,
};
