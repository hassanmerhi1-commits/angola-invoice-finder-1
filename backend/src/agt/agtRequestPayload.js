/**
 * Format stored agt_transmissions.request_payload for the AGT Partner Portal paste boxes.
 */

function parseAgtRequestPayload(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isLiveRegistarFacturaPayload(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const version = String(obj.schemaVersion || '');
  return /^[12]\./.test(version) && Array.isArray(obj.documents);
}

/** Schema 2.0 requires this on NC/ND lines. JWS does not cover lines, so Copy JSON can fill it. */
function ensureReferenceItemLineNo(obj) {
  if (!obj || !Array.isArray(obj.documents)) return obj;
  for (const doc of obj.documents) {
    const type = String(doc.documentType || '').toUpperCase();
    if (type !== 'NC' && type !== 'ND') continue;
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      if (!line.referenceInfo || typeof line.referenceInfo !== 'object') continue;
      const existing = Number(line.referenceInfo.referenceItemLineNo);
      if (Number.isInteger(existing) && existing >= 1) continue;
      const n = Number(line.lineNumber);
      line.referenceInfo.referenceItemLineNo = Number.isInteger(n) && n >= 1 ? n : 1;
    }
  }
  return obj;
}

function formatAgtRequestPayloadForPortal(raw) {
  const obj = parseAgtRequestPayload(raw);
  if (!obj) {
    throw new Error('JSON da transmissão em falta ou inválido');
  }
  const live = isLiveRegistarFacturaPayload(obj);
  const patched = live ? ensureReferenceItemLineNo(obj) : obj;
  const doc = Array.isArray(patched.documents) ? patched.documents[0] : null;
  return {
    json: JSON.stringify(patched),
    simulated: !live,
    schemaVersion: patched.schemaVersion || null,
    documentType: (doc && doc.documentType) || patched.documentType || null,
    documentNo: (doc && doc.documentNo) || patched.documentNumber || patched.documentNo || null,
  };
}

module.exports = {
  parseAgtRequestPayload,
  isLiveRegistarFacturaPayload,
  formatAgtRequestPayloadForPortal,
};
