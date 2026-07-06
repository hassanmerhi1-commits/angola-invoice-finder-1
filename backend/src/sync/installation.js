/**
 * Installation / topology config — DB row + env overrides.
 */
const crypto = require('crypto');
const db = require('../db');
const { activeFlagWhere, mainBranchWhere } = require('../lib/sqlDialect');

const ENV_ROLE = (process.env.NEXOR_INSTALLATION_ROLE || '').trim();
const ENV_MAIN_URL = (process.env.NEXOR_MAIN_API_URL || '').trim();
const ENV_API_KEY = (process.env.NEXOR_SYNC_API_KEY || '').trim();
const ENV_CITY_ID = (process.env.NEXOR_CITY_ID || '').trim();

let cachedInstallation = null;
let cacheAt = 0;
const CACHE_MS = 5000;

function generateApiKey() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Repair a possibly-malformed base URL: `http//host` / `http:/host` → `http://host`,
 * bare `host[:port]` → `http://host[:port]`. Returns null for empty input.
 */
function normalizeMainApiUrl(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  const scheme = s.match(/^(https?)\b[:/]*(.*)$/i);
  if (scheme) return `${scheme[1].toLowerCase()}://${scheme[2]}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return `http://${s}`;
  return s;
}

async function tableExists(name) {
  try {
    if (db.engine === 'postgres') {
      const r = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
        [name]
      );
      return r.rows.length > 0;
    }
    const r = await db.query(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      [name]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function loadInstallationFromDb() {
  if (!(await tableExists('installations'))) return null;
  const r = await db.query(
    `SELECT * FROM installations WHERE ${activeFlagWhere(db, 'is_active')}
     ORDER BY created_at ASC LIMIT 1`
  );
  return r.rows[0] || null;
}

async function getInstallationConfig(force = false) {
  const now = Date.now();
  if (!force && cachedInstallation && now - cacheAt < CACHE_MS) {
    return cachedInstallation;
  }

  const row = await loadInstallationFromDb();
  const mainBranch = await db.query(
    `SELECT id, city_id, node_role FROM branches WHERE ${mainBranchWhere(db)} LIMIT 1`
  ).catch(() => ({ rows: [] }));

  const isMain = !!(mainBranch.rows[0]?.id);
  let role = ENV_ROLE || row?.role || (isMain ? 'main_server' : 'city_server');

  const config = {
    id: row?.id || 'env-default',
    role,
    cityId: ENV_CITY_ID || row?.city_id || mainBranch.rows[0]?.city_id || null,
    branchId: row?.branch_id || mainBranch.rows[0]?.id || null,
    mainApiUrl: normalizeMainApiUrl(ENV_MAIN_URL || row?.main_api_url || null),
    apiKey: ENV_API_KEY || row?.api_key || null,
    isMainServer: role === 'main_server',
    isCityServer: role === 'city_server',
    isShopClient: role === 'shop_client',
  };

  if (!config.apiKey && config.isCityServer) {
    config.apiKey = generateApiKey();
  }

  cachedInstallation = config;
  cacheAt = now;
  return config;
}

function invalidateInstallationCache() {
  cachedInstallation = null;
  cacheAt = 0;
}

async function ensureDefaultInstallation(opts = {}) {
  if (!(await tableExists('installations'))) return null;

  const existing = await loadInstallationFromDb();
  if (existing) return existing;

  const mainRes = await db.query(
    `SELECT id FROM branches WHERE ${mainBranchWhere(db)} ORDER BY created_at LIMIT 1`
  );
  const mainId = mainRes.rows[0]?.id;
  const role = opts.role || (mainId ? 'main_server' : 'city_server');
  const apiKey = opts.apiKey || generateApiKey();
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO installations (id, name, role, city_id, branch_id, main_api_url, api_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      opts.name || 'NEXOR Installation',
      role,
      opts.cityId || null,
      opts.branchId || mainId || null,
      opts.mainApiUrl || null,
      apiKey,
    ]
  );
  invalidateInstallationCache();
  return { id, role, api_key: apiKey };
}

async function upsertCityFromLocation(province, municipio) {
  if (!(await tableExists('cities'))) return null;
  const code = `${province || 'XX'}-${municipio || 'city'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'city-default';

  const found = await db.query(`SELECT id FROM cities WHERE code = $1 LIMIT 1`, [code]);
  if (found.rows.length > 0) return found.rows[0].id;

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO cities (id, name, province, municipio, code) VALUES ($1, $2, $3, $4, $5)`,
    [id, municipio || province || 'Cidade', province || null, municipio || null, code]
  );
  return id;
}

module.exports = {
  getInstallationConfig,
  ensureDefaultInstallation,
  upsertCityFromLocation,
  invalidateInstallationCache,
  generateApiKey,
};
