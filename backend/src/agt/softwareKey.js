/**
 * NEXOR producer key for jwsSoftwareSignature. The public half is registered on the AGT
 * Partner Portal; the private half must never be committed (the repository is public).
 *
 * Lookup order: AGT_SOFTWARE_PRIVATE_KEY (inline PEM, "\n" escapes allowed),
 * AGT_SOFTWARE_KEY_FILE, then agt-software-key.pem in the working dir, the backend dir,
 * or the Windows install dir.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FILE_NAME = 'agt-software-key.pem';
const CACHE_MS = 60_000;

let cached = { at: 0, value: null };

function candidatePaths() {
  const list = [];
  const explicit = String(process.env.AGT_SOFTWARE_KEY_FILE || '').trim();
  if (explicit) list.push(explicit);
  list.push(path.resolve(process.cwd(), KEY_FILE_NAME));
  list.push(path.resolve(__dirname, '..', '..', KEY_FILE_NAME));
  if (process.platform === 'win32') list.push(path.join('C:\\NEXOR ERP', KEY_FILE_NAME));
  return [...new Set(list)];
}

function validPem(pem) {
  try {
    const key = crypto.createPrivateKey(pem);
    const bits = key.asymmetricKeyDetails?.modulusLength || 0;
    return key.asymmetricKeyType === 'rsa' && bits >= 2048;
  } catch {
    return false;
  }
}

/** @returns {{ pem: string, source: string } | null} */
function loadSoftwarePrivateKey() {
  if (Date.now() - cached.at < CACHE_MS) return cached.value;
  let value = null;
  const inline = String(process.env.AGT_SOFTWARE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (inline && validPem(inline)) {
    value = { pem: inline, source: 'env:AGT_SOFTWARE_PRIVATE_KEY' };
  } else {
    for (const file of candidatePaths()) {
      try {
        if (!fs.existsSync(file)) continue;
        const pem = fs.readFileSync(file, 'utf8');
        if (validPem(pem)) {
          value = { pem, source: file };
          break;
        }
        console.warn('[AGT] software key file is not an RSA ≥2048 private key:', file);
      } catch (e) {
        console.warn('[AGT] could not read software key file', file, e.message);
      }
    }
  }
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Producer key when installed; otherwise the taxpayer key (pre-registration behaviour) with a
 * warning, so homologation keeps working until the Partner Portal key is in place.
 */
function resolveSoftwareSigningKey(taxpayerPem) {
  const software = loadSoftwarePrivateKey();
  if (software) return software.pem;
  if (!resolveSoftwareSigningKey.warned) {
    resolveSoftwareSigningKey.warned = true;
    console.warn(
      `[AGT] ${KEY_FILE_NAME} not found — jwsSoftwareSignature is signed with the company key. ` +
        'Install the NEXOR producer key registered on the AGT Partner Portal before going live.',
    );
  }
  return taxpayerPem;
}

function clearSoftwareKeyCache() {
  cached = { at: 0, value: null };
}

module.exports = {
  KEY_FILE_NAME,
  loadSoftwarePrivateKey,
  resolveSoftwareSigningKey,
  clearSoftwareKeyCache,
};
