/** Convert SAF-T JSON structure to AGT XML. */

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatXmlValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '0.00';
  return escapeXml(value);
}

function jsonToXml(obj, indent = '') {
  let xml = '';
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@') || value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'object') {
          xml += `${indent}<${key}>\n${jsonToXml(item, indent + '  ')}${indent}</${key}>\n`;
        } else {
          xml += `${indent}<${key}>${formatXmlValue(item)}</${key}>\n`;
        }
      }
    } else if (typeof value === 'object') {
      xml += `${indent}<${key}>\n${jsonToXml(value, indent + '  ')}${indent}</${key}>\n`;
    } else {
      xml += `${indent}<${key}>${formatXmlValue(value)}</${key}>\n`;
    }
  }
  return xml;
}

function saftToXml(saft) {
  const auditFile = {
    '@xmlns': 'urn:OECD:StandardAuditFile-Tax:AO_1.01_01',
    ...saft.AuditFile,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:AO_1.01_01">\n${jsonToXml(auditFile, 1)}</AuditFile>`;
}

function buildSaftFilename(company, period, ext = 'xml') {
  const nif = (company?.nif || '0000000000').replace(/\D/g, '') || '0000000000';
  const start = period.start.replace(/-/g, '');
  const end = period.end.replace(/-/g, '');
  return `SAFT-AO_${nif}_${start}_${end}.${ext}`;
}

module.exports = { saftToXml, buildSaftFilename, jsonToXml };
