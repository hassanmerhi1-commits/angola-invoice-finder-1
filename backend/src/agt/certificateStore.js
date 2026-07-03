/**
 * PKCS#12 certificate storage for AGT fiscal signing.
 * PFX files live under NEXOR data/signing/; passphrases are encrypted at rest.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');
const { randomUUID } = require('crypto');
const db = require('../db');
const { isTruthySql } = require('../lib/sqlDialect');

const SIGNING_MATERIAL_CACHE_MS = 5 * 60 * 1000;
let cachedSigningMaterial = null;
let cachedSigningMaterialAt = 0;

function clearSigningMaterialCache() {
  cachedSigningMaterial = null;
  cachedSigningMaterialAt = 0;
}

function signingDir() {
  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const dir = path.join(installDir, 'data', 'signing');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function encryptionKey() {
  const { deriveKey } = require('../lib/nexorSecrets');
  return deriveKey('signing', 'nexor-fiscal-salt');
}

function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptSecret(encoded) {
  if (!encoded) return '';
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function parsePkcs12(pfxBuffer, passphrase) {
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase || '');
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert
    || p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
  const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key
    || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]?.key;

  if (!privateKey) throw new Error('Chave privada não encontrada no certificado PKCS#12');
  if (!cert) throw new Error('Certificado X.509 não encontrado no ficheiro PKCS#12');

  const publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const subjectCn = cert.subject.getField('CN')?.value || cert.subject.attributes?.[0]?.value || '';
  const validFrom = cert.validity.notBefore;
  const validUntil = cert.validity.notAfter;
  const modulusBits = cert.publicKey.n.bitLength();
  const keyType = modulusBits >= 4096 ? 'RSA-4096' : 'RSA-2048';

  return {
    publicKeyPem,
    privateKeyPem,
    subjectCn,
    validFrom,
    validUntil,
    keyType,
  };
}

function testPrivateKey(privateKeyPem) {
  const sample = 'nexor-fiscal-signing-self-test';
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(sample);
  signer.end();
  const signature = signer.sign(privateKeyPem, 'base64');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(sample);
  verifier.end();
  if (!verifier.verify(crypto.createPrivateKey(privateKeyPem), signature, 'base64')) {
    throw new Error('Falha no teste de assinatura RSA');
  }
}

async function importCertificate({ alias, pfxBase64, passphrase, certificateNumber }) {
  if (!alias?.trim()) throw new Error('Alias do certificado é obrigatório');
  if (!pfxBase64) throw new Error('Ficheiro PKCS#12 (.pfx) é obrigatório');

  const pfxBuffer = Buffer.from(pfxBase64, 'base64');
  if (pfxBuffer.length < 100) throw new Error('Ficheiro PKCS#12 inválido');

  const parsed = parsePkcs12(pfxBuffer, passphrase);
  testPrivateKey(parsed.privateKeyPem);

  const keyId = randomUUID();
  const pfxPath = path.join(signingDir(), `${keyId}.pfx`);
  fs.writeFileSync(pfxPath, pfxBuffer);

  const privateKeyHash = crypto.createHash('sha256').update(pfxBuffer).digest('hex');
  const encryptedPassphrase = encryptSecret(passphrase || '');

  await db.query(
    `INSERT INTO signing_keys (
      id, key_alias, key_type, public_key_pem, private_key_hash,
      certificate_number, subject_cn, valid_from, valid_until,
      encrypted_passphrase, pfx_storage_path, is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)`,
    [
      keyId,
      alias.trim(),
      parsed.keyType,
      parsed.publicKeyPem,
      privateKeyHash,
      certificateNumber || null,
      parsed.subjectCn,
      parsed.validFrom.toISOString(),
      parsed.validUntil.toISOString(),
      encryptedPassphrase,
      pfxPath,
    ],
  );

  return {
    id: keyId,
    alias: alias.trim(),
    keyType: parsed.keyType,
    subjectCn: parsed.subjectCn,
    validFrom: parsed.validFrom.toISOString(),
    validUntil: parsed.validUntil.toISOString(),
  };
}

async function findCertificateByAlias(alias) {
  const trimmed = String(alias || '').trim();
  if (!trimmed) return null;
  const res = await db.query(
    `SELECT id, key_alias, key_type, certificate_number, subject_cn, valid_from, valid_until,
            pfx_storage_path, is_active
     FROM signing_keys WHERE key_alias = $1 LIMIT 1`,
    [trimmed],
  ).catch(() => ({ rows: [] }));
  return res.rows[0] || null;
}

async function activateCertificate(keyId) {
  const res = await db.query('SELECT id FROM signing_keys WHERE id = $1', [keyId]);
  if (!res.rows.length) throw new Error('Certificado não encontrado');
  await db.query(`UPDATE signing_keys SET is_active = $1 WHERE ${isTruthySql(db, 'is_active')}`, [false]);
  await db.query('UPDATE signing_keys SET is_active = $1 WHERE id = $2', [true, keyId]);
  clearSigningMaterialCache();
  return { success: true };
}

async function deleteCertificate(keyId, options = {}) {
  const { force = false } = options;
  const res = await db.query(
    'SELECT pfx_storage_path, is_active FROM signing_keys WHERE id = $1',
    [keyId],
  );
  if (!res.rows.length) throw new Error('Certificado não encontrado');
  if (!force && (res.rows[0].is_active === true || res.rows[0].is_active === 1)) {
    throw new Error('Não pode remover o certificado activo');
  }
  const pfxPath = res.rows[0].pfx_storage_path;
  await db.query('DELETE FROM signing_keys WHERE id = $1', [keyId]);
  if (pfxPath && fs.existsSync(pfxPath)) {
    try { fs.unlinkSync(pfxPath); } catch (_) {}
  }
  clearSigningMaterialCache();
  return { success: true };
}

async function loadActiveSigningMaterial() {
  if (cachedSigningMaterial && Date.now() - cachedSigningMaterialAt < SIGNING_MATERIAL_CACHE_MS) {
    return cachedSigningMaterial;
  }
  const res = await db.query(
    `SELECT id, key_alias, public_key_pem, encrypted_passphrase, pfx_storage_path, valid_until
     FROM signing_keys
     WHERE ${isTruthySql(db, 'is_active')}
     ORDER BY created_at DESC
     LIMIT 1`,
  ).catch(() => ({ rows: [] }));

  if (!res.rows.length) return null;
  const row = res.rows[0];
  if (row.valid_until && new Date(row.valid_until) < new Date()) {
    console.warn('[SIGNING] Active certificate expired:', row.key_alias);
    return null;
  }

  let privateKeyPem = null;
  if (row.pfx_storage_path && fs.existsSync(row.pfx_storage_path)) {
    const passphrase = decryptSecret(row.encrypted_passphrase);
    const parsed = parsePkcs12(fs.readFileSync(row.pfx_storage_path), passphrase);
    privateKeyPem = parsed.privateKeyPem;
  }

  if (!privateKeyPem) return null;

  const material = {
    keyId: row.id,
    keyAlias: row.key_alias,
    publicKeyPem: row.public_key_pem,
    privateKeyPem,
  };
  cachedSigningMaterial = material;
  cachedSigningMaterialAt = Date.now();
  return material;
}

/** Self-signed PKCS#12 for internal AGT certification demos (not valid for live AGT). */
function generateDemoPkcs12({ commonName = 'NEXOR ERP Demo', passphrase = 'nexor-demo' } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);
  const attrs = [{ name: 'commonName', value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    passphrase,
    { algorithm: '3des' },
  );
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

module.exports = {
  importCertificate,
  findCertificateByAlias,
  activateCertificate,
  deleteCertificate,
  loadActiveSigningMaterial,
  parsePkcs12,
  generateDemoPkcs12,
};
