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
  return version.startsWith('1.') && Array.isArray(obj.documents);
}

function formatAgtRequestPayloadForPortal(raw) {
  const obj = parseAgtRequestPayload(raw);
  if (!obj) {
    throw new Error('JSON da transmissão em falta ou inválido');
  }
  const live = isLiveRegistarFacturaPayload(obj);
  const doc = Array.isArray(obj.documents) ? obj.documents[0] : null;
  return {
    json: JSON.stringify(obj),
    simulated: !live,
    schemaVersion: obj.schemaVersion || null,
    documentType: (doc && doc.documentType) || obj.documentType || null,
    documentNo: (doc && doc.documentNo) || obj.documentNumber || obj.documentNo || null,
  };
}

module.exports = {
  parseAgtRequestPayload,
  isLiveRegistarFacturaPayload,
  formatAgtRequestPayloadForPortal,
};
