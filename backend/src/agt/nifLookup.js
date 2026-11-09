/**
 * NIF → registered name.
 *
 * AGT runs the NIF consultation as its own webservice with its own username and password, so the
 * settings here are separate from the invoice connection. The address and message format arrive
 * with those credentials; the request is Basic Auth like the invoice API, and the answer is read
 * leniently (JSON or XML) so the stored address is the only thing that has to match AGT.
 */
const db = require('../db');
const { encryptApiKey, decryptApiKey } = require('./agtConfig');

const CONFIG_ID = 'default';
const CACHE_DAYS = 30;
const TIMEOUT_MS = 8000;
const RAW_LIMIT = 4000;

const NAME_KEYS = [
  'nome', 'nomecontribuinte', 'nomecompleto', 'denominacao', 'denominacaosocial', 'designacao',
  'designacaosocial', 'razaosocial', 'companyname', 'taxpayername', 'name', 'nomecomercial',
];
const ADDRESS_KEYS = ['morada', 'moradacompleta', 'endereco', 'address', 'domiciliofiscal'];
const STATUS_KEYS = ['estadocontribuinte', 'situacaocontribuinte', 'estado', 'situacao'];

function normalizeNif(value) {
  return String(value || '').replace(/[\s.-]/g, '').toUpperCase();
}

function isLookupableNif(nif) {
  return /^[0-9A-Z]{9,14}$/.test(nif) && nif !== '999999999' && nif !== '999999990';
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

async function readConfigRow() {
  const res = await db.query('SELECT * FROM agt_config WHERE id = $1', [CONFIG_ID]).catch(() => ({ rows: [] }));
  return res.rows[0] || {};
}

function mapConfig(row) {
  return {
    enabled: truthy(row.nif_lookup_enabled),
    url: row.nif_lookup_url || '',
    method: String(row.nif_lookup_method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
    username: row.nif_lookup_username || '',
    hasPassword: Boolean(row.nif_lookup_password_encrypted),
  };
}

async function getNifLookupConfig() {
  return mapConfig(await readConfigRow());
}

async function getNifLookupConfigWithSecret() {
  const row = await readConfigRow();
  return { ...mapConfig(row), password: decryptApiKey(row.nif_lookup_password_encrypted) };
}

function isConfigured(config) {
  return Boolean(config.enabled && config.url && config.username && config.password);
}

async function saveNifLookupConfig(payload = {}) {
  const row = await readConfigRow();
  let encrypted = row.nif_lookup_password_encrypted || null;
  const password = String(payload.password || '');
  if (password && password !== '********') encrypted = encryptApiKey(password);

  const method = String(payload.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const url = String(payload.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error('O endereço da consulta de NIF tem de começar por https://');
  }

  await db.query(
    `INSERT INTO agt_config (id, environment, simulate, auto_transmit)
     VALUES ($1, 'sandbox', true, true)
     ON CONFLICT (id) DO NOTHING`,
    [CONFIG_ID],
  ).catch(() => {});
  await db.query(
    `UPDATE agt_config SET
       nif_lookup_enabled = $2,
       nif_lookup_url = $3,
       nif_lookup_method = $4,
       nif_lookup_username = $5,
       nif_lookup_password_encrypted = $6,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [CONFIG_ID, Boolean(payload.enabled), url || null, method, String(payload.username || '').trim() || null, encrypted],
  );
  return getNifLookupConfig();
}

function keyOf(key) {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/** First non-empty string under any of `keys`, searched breadth-first so top-level fields win. */
function findField(body, keys) {
  const queue = [body];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const entries = Object.entries(node);
    for (const wanted of keys) {
      for (const [key, value] of entries) {
        if (keyOf(key) === wanted && (typeof value === 'string' || typeof value === 'number')) {
          const text = String(value).trim();
          if (text) return text;
        }
      }
    }
    for (const [, value] of entries) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}

function findXmlField(text, keys) {
  for (const wanted of keys) {
    const re = /<(?:[\w-]+:)?([\w-]+)(?:\s[^>]*)?>([^<]+)<\/(?:[\w-]+:)?\1>/g;
    let match;
    while ((match = re.exec(text))) {
      if (keyOf(match[1]) === wanted && match[2].trim()) return decodeXml(match[2].trim());
    }
  }
  return '';
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseRemoteBody(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { name: '', address: '', taxpayerStatus: '' };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const body = JSON.parse(trimmed);
      return {
        name: findField(body, NAME_KEYS),
        address: findField(body, ADDRESS_KEYS),
        taxpayerStatus: findField(body, STATUS_KEYS),
      };
    } catch (_) { /* fall through to XML/text */ }
  }
  if (trimmed.startsWith('<')) {
    return {
      name: findXmlField(trimmed, NAME_KEYS),
      address: findXmlField(trimmed, ADDRESS_KEYS),
      taxpayerStatus: findXmlField(trimmed, STATUS_KEYS),
    };
  }
  return { name: '', address: '', taxpayerStatus: '' };
}

function buildRequestUrl(config, nif) {
  const encoded = encodeURIComponent(nif);
  if (config.url.includes('{nif}')) return config.url.replace(/\{nif\}/g, encoded);
  if (config.method === 'POST') return config.url;
  return `${config.url}${config.url.includes('?') ? '&' : '?'}nif=${encoded}`;
}

async function callAgt(config, nif) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const auth = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');
  try {
    const res = await fetch(buildRequestUrl(config, nif), {
      method: config.method,
      headers: {
        Accept: 'application/json, application/xml;q=0.9, */*;q=0.5',
        Authorization: `Basic ${auth}`,
        ...(config.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: config.method === 'POST' ? JSON.stringify({ nif }) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    return { httpStatus: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

async function findSavedParty(nif) {
  const client = await db.query(
    `SELECT id, name, address, phone FROM clients
     WHERE UPPER(REPLACE(COALESCE(nif, ''), ' ', '')) = $1
     ORDER BY updated_at DESC LIMIT 1`,
    [nif],
  ).catch(() => ({ rows: [] }));
  if (client.rows[0]?.name) {
    const row = client.rows[0];
    return { source: 'client', clientId: String(row.id), name: row.name, address: row.address || '', phone: row.phone || '' };
  }
  const supplier = await db.query(
    `SELECT id, name, address, phone FROM suppliers
     WHERE UPPER(REPLACE(COALESCE(nif, ''), ' ', '')) = $1
     ORDER BY updated_at DESC LIMIT 1`,
    [nif],
  ).catch(() => ({ rows: [] }));
  if (supplier.rows[0]?.name) {
    const row = supplier.rows[0];
    return { source: 'supplier', supplierId: String(row.id), name: row.name, address: row.address || '', phone: row.phone || '' };
  }
  return null;
}

async function findPreviousInvoiceName(nif) {
  const res = await db.query(
    `SELECT customer_name FROM sales
     WHERE UPPER(REPLACE(COALESCE(customer_nif, ''), ' ', '')) = $1
       AND TRIM(COALESCE(customer_name, '')) != ''
       AND LOWER(customer_name) NOT LIKE 'consumidor final%'
     ORDER BY created_at DESC LIMIT 1`,
    [nif],
  ).catch(() => ({ rows: [] }));
  return res.rows[0]?.customer_name || '';
}

async function readCache(nif) {
  const res = await db.query('SELECT * FROM nif_lookup_cache WHERE nif = $1', [nif]).catch(() => ({ rows: [] }));
  const row = res.rows[0];
  if (!row?.name) return null;
  const fetched = new Date(row.fetched_at).getTime();
  if (Number.isFinite(fetched) && Date.now() - fetched > CACHE_DAYS * 86400000) return null;
  return row;
}

async function writeCache(nif, parsed, raw) {
  await db.query(
    `INSERT INTO nif_lookup_cache (nif, name, address, taxpayer_status, raw_response, fetched_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (nif) DO UPDATE SET
       name = EXCLUDED.name,
       address = EXCLUDED.address,
       taxpayer_status = EXCLUDED.taxpayer_status,
       raw_response = EXCLUDED.raw_response,
       fetched_at = CURRENT_TIMESTAMP`,
    [nif, parsed.name, parsed.address || null, parsed.taxpayerStatus || null, String(raw || '').slice(0, RAW_LIMIT)],
  ).catch((err) => console.warn('[NIF] cache write failed:', err.message));
}

/**
 * @returns {Promise<{
 *   nif: string, status: 'found'|'not_found'|'not_configured'|'unavailable'|'auth_failed'|'invalid',
 *   source?: 'client'|'supplier'|'agt'|'cache'|'history', name?: string, address?: string, phone?: string,
 *   taxpayerStatus?: string, clientId?: string, supplierId?: string, message?: string,
 *   httpStatus?: number, raw?: string
 * }>}
 */
async function lookupNif(rawNif, { remoteOnly = false, includeRaw = false } = {}) {
  const nif = normalizeNif(rawNif);
  if (!isLookupableNif(nif)) return { nif, status: 'invalid' };

  if (!remoteOnly) {
    const saved = await findSavedParty(nif);
    if (saved) return { nif, status: 'found', ...saved };
    const cached = await readCache(nif);
    if (cached) {
      return {
        nif,
        status: 'found',
        source: 'cache',
        name: cached.name,
        address: cached.address || '',
        taxpayerStatus: cached.taxpayer_status || '',
      };
    }
  }

  const config = await getNifLookupConfigWithSecret();
  const fallback = async (result) => {
    if (remoteOnly) return result;
    const previous = await findPreviousInvoiceName(nif);
    return previous ? { ...result, status: 'found', source: 'history', name: previous } : result;
  };

  if (!isConfigured(config)) return fallback({ nif, status: 'not_configured' });

  let response;
  try {
    response = await callAgt(config, nif);
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'A AGT não respondeu a tempo' : (err?.message || 'Sem ligação à AGT');
    return fallback({ nif, status: 'unavailable', message });
  }

  const raw = includeRaw ? response.text.slice(0, RAW_LIMIT) : undefined;
  if (response.httpStatus === 401 || response.httpStatus === 403) {
    return { nif, status: 'auth_failed', httpStatus: response.httpStatus, raw, message: 'A AGT recusou o utilizador ou a palavra-passe da consulta de NIF' };
  }
  const parsed = parseRemoteBody(response.text);
  if (response.ok && parsed.name) {
    await writeCache(nif, parsed, response.text);
    return { nif, status: 'found', source: 'agt', ...parsed, httpStatus: response.httpStatus, raw };
  }
  if (response.httpStatus === 404 || (response.ok && !parsed.name)) {
    return { nif, status: 'not_found', httpStatus: response.httpStatus, raw };
  }
  return fallback({
    nif,
    status: 'unavailable',
    httpStatus: response.httpStatus,
    raw,
    message: `A AGT respondeu HTTP ${response.httpStatus}`,
  });
}

module.exports = {
  lookupNif,
  getNifLookupConfig,
  saveNifLookupConfig,
  parseRemoteBody,
  normalizeNif,
};
