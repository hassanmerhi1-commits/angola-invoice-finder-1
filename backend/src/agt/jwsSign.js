/**
 * Compact JWS RS256 (typ JOSE) as required by AGT Facturação Electrónica.
 * Payload JSON key order is insertion order — do not reorder fields.
 */
const crypto = require('crypto');

function base64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJws(payloadObject, privateKeyPem) {
  if (!privateKeyPem) {
    throw new Error('Chave privada RSA em falta para assinar JWS AGT');
  }
  const header = { typ: 'JOSE', alg: 'RS256' };
  const headerB64 = base64Url(JSON.stringify(header));
  const payloadB64 = base64Url(JSON.stringify(payloadObject));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

function decodeJwsPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

module.exports = { signJws, decodeJwsPayload, base64Url };
