/**
 * AGT API configuration — DB-backed with environment variable fallback.
 */
const crypto = require('crypto');
const db = require('../db');

const CONFIG_ID = 'default';

function encryptionKey() {
  const { deriveKey } = require('../lib/nexorSecrets');
  return deriveKey('agt-api', 'nexor-agt-salt');
}

function encryptApiKey(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptApiKey(encoded) {
  if (!encoded) return '';
  try {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function mapRow(row) {
  if (!row) return null;
  const simulate = row.simulate === true || row.simulate === 1;
  const autoTransmit = row.auto_transmit === true || row.auto_transmit === 1;
  return {
    id: row.id || CONFIG_ID,
    environment: row.environment || 'sandbox',
    apiUrl: row.api_url || process.env.AGT_API_URL || '',
    statusUrl: row.status_url || process.env.AGT_STATUS_URL || '',
    companyNif: row.company_nif || process.env.AGT_COMPANY_NIF || '',
    softwareCertificateNumber: row.software_certificate_number || process.env.AGT_SOFTWARE_CERT || '',
    simulate,
    autoTransmit,
    hasApiKey: Boolean(row.api_key_encrypted || process.env.AGT_API_KEY),
    updatedAt: row.updated_at,
  };
}

async function getAgtConfig() {
  const res = await db.query('SELECT * FROM agt_config WHERE id = $1', [CONFIG_ID]).catch(() => ({ rows: [] }));
  if (!res.rows.length) {
    return mapRow({
      id: CONFIG_ID,
      environment: process.env.AGT_ENVIRONMENT || 'sandbox',
      api_url: process.env.AGT_API_URL || '',
      simulate: process.env.AGT_SIMULATE !== 'false',
      auto_transmit: true,
    });
  }
  return mapRow(res.rows[0]);
}

async function getAgtConfigWithSecrets() {
  const res = await db.query('SELECT * FROM agt_config WHERE id = $1', [CONFIG_ID]).catch(() => ({ rows: [] }));
  const row = res.rows[0] || {};
  const config = mapRow(row);
  const apiKey = decryptApiKey(row.api_key_encrypted) || process.env.AGT_API_KEY || '';
  return { ...config, apiKey };
}

async function saveAgtConfig(payload) {
  const {
    environment = 'sandbox',
    apiUrl = '',
    apiKey = '',
    statusUrl = '',
    companyNif = '',
    softwareCertificateNumber = '',
    simulate = true,
    autoTransmit = true,
  } = payload || {};

  const existing = await db.query('SELECT api_key_encrypted FROM agt_config WHERE id = $1', [CONFIG_ID]);
  let encryptedKey = existing.rows[0]?.api_key_encrypted || null;
  if (apiKey && apiKey !== '********') {
    encryptedKey = encryptApiKey(apiKey);
  }

  await db.query(
    `INSERT INTO agt_config (
      id, environment, api_url, api_key_encrypted, status_url,
      company_nif, software_certificate_number, simulate, auto_transmit, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      environment = EXCLUDED.environment,
      api_url = EXCLUDED.api_url,
      api_key_encrypted = COALESCE(EXCLUDED.api_key_encrypted, agt_config.api_key_encrypted),
      status_url = EXCLUDED.status_url,
      company_nif = EXCLUDED.company_nif,
      software_certificate_number = EXCLUDED.software_certificate_number,
      simulate = EXCLUDED.simulate,
      auto_transmit = EXCLUDED.auto_transmit,
      updated_at = CURRENT_TIMESTAMP`,
    [
      CONFIG_ID,
      environment,
      apiUrl || null,
      encryptedKey,
      statusUrl || null,
      companyNif || null,
      softwareCertificateNumber || null,
      simulate,
      autoTransmit,
    ],
  );

  return getAgtConfig();
}

module.exports = {
  getAgtConfig,
  getAgtConfigWithSecrets,
  saveAgtConfig,
};
