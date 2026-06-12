/**
 * Machine-local secret material for JWT and encryption at rest (AGT keys, PKCS#12 passphrases).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function installDir() {
  return process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
}

function secretsDir() {
  const dir = path.join(installDir(), 'data', 'secrets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSecretFile(filename) {
  const filePath = path.join(secretsDir(), filename);
  if (!fs.existsSync(filePath)) return null;
  const value = fs.readFileSync(filePath, 'utf8').trim();
  return value || null;
}

function writeSecretFile(filename, value) {
  const filePath = path.join(secretsDir(), filename);
  fs.writeFileSync(filePath, value, { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

function loadOrCreateMasterSecret() {
  if (process.env.NEXOR_SECRET_KEY) {
    return { value: process.env.NEXOR_SECRET_KEY, source: 'env' };
  }
  const fromFile = readSecretFile('master.key');
  if (fromFile) {
    return { value: fromFile, source: 'file' };
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    writeSecretFile('master.key', generated);
    console.log('[SECURITY] Generated master.key (persisted for encryption at rest)');
    return { value: generated, source: 'generated' };
  } catch (err) {
    console.warn('[SECURITY] Could not persist master.key:', err.message);
    return { value: generated, source: 'ephemeral' };
  }
}

function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) {
    return { value: process.env.JWT_SECRET, source: 'env', persistent: true };
  }
  const fromFile = readSecretFile('jwt.secret');
  if (fromFile) {
    return { value: fromFile, source: 'file', persistent: true };
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    writeSecretFile('jwt.secret', generated);
    console.log('[SECURITY] Generated jwt.secret (sessions survive restart)');
    return { value: generated, source: 'generated', persistent: true };
  } catch (err) {
    console.warn('[SECURITY] JWT_SECRET not set; using ephemeral secret for this process');
    return { value: generated, source: 'ephemeral', persistent: false };
  }
}

function deriveKey(purpose, salt) {
  const { value } = loadOrCreateMasterSecret();
  return crypto.scryptSync(`${value}:${purpose}`, salt, 32);
}

function isMasterSecretConfigured() {
  return Boolean(process.env.NEXOR_SECRET_KEY || readSecretFile('master.key'));
}

function isJwtSecretConfigured() {
  return Boolean(process.env.JWT_SECRET || readSecretFile('jwt.secret'));
}

module.exports = {
  installDir,
  secretsDir,
  loadOrCreateMasterSecret,
  loadOrCreateJwtSecret,
  deriveKey,
  isMasterSecretConfigured,
  isJwtSecretConfigured,
};
