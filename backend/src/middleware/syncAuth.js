const db = require('../db');
const { activeFlagWhere } = require('../lib/sqlDialect');

let clientIngestWarned = false;

function extractSyncToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return (req.headers['x-sync-api-key'] || '').trim();
}

function configuredClientIngestKeys() {
  const clientKey = (process.env.NEXOR_CLIENT_SYNC_API_KEY || '').trim();
  const syncKey = (process.env.NEXOR_SYNC_API_KEY || '').trim();
  return { clientKey, syncKey, any: !!(clientKey || syncKey) };
}

async function resolveInstallationByToken(token) {
  if (!token) return null;
  try {
    const r = await db.query(
      `SELECT id, role, city_id, branch_id FROM installations
       WHERE api_key = $1 AND ${activeFlagWhere(db, 'is_active')} LIMIT 1`,
      [token]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

async function authenticateSyncIngest(req, res, next) {
  const token = extractSyncToken(req);
  const envKey = (process.env.NEXOR_SYNC_API_KEY || '').trim();

  if (envKey && token === envKey) {
    req.syncAuth = { source: 'env' };
    return next();
  }

  const installation = await resolveInstallationByToken(token);
  if (installation) {
    req.syncAuth = { source: 'installation', installation };
    return next();
  }

  return res.status(401).json({ error: 'Invalid sync API key' });
}

/**
 * Shop client → city server ingest.
 * Fail-closed: require env key or installation API key.
 * Open ingest only when NEXOR_ALLOW_OPEN_CLIENT_INGEST=1 (dev/legacy) or NODE_ENV=test.
 */
async function authenticateClientIngest(req, res, next) {
  const token = extractSyncToken(req);
  const { clientKey, syncKey, any } = configuredClientIngestKeys();

  if (clientKey && token === clientKey) {
    req.syncAuth = { source: 'env-client' };
    return next();
  }

  if (syncKey && token === syncKey) {
    req.syncAuth = { source: 'env' };
    return next();
  }

  const installation = await resolveInstallationByToken(token);
  if (installation && ['shop_client', 'city_server'].includes(installation.role)) {
    req.syncAuth = { source: 'installation', installation };
    return next();
  }

  const allowOpen =
    process.env.NEXOR_ALLOW_OPEN_CLIENT_INGEST === '1'
    || process.env.NODE_ENV === 'test';

  if (!any && allowOpen) {
    if (!clientIngestWarned) {
      clientIngestWarned = true;
      console.warn(
        '[SYNC] client-ingest is open (NEXOR_ALLOW_OPEN_CLIENT_INGEST) — set NEXOR_CLIENT_SYNC_API_KEY for production'
      );
    }
    req.syncAuth = { source: 'open' };
    return next();
  }

  return res.status(401).json({
    error: 'Client sync API key required',
    hint: 'Set NEXOR_CLIENT_SYNC_API_KEY (or NEXOR_SYNC_API_KEY) and send Authorization Bearer / X-Sync-Api-Key',
  });
}

module.exports = {
  extractSyncToken,
  authenticateSyncIngest,
  authenticateClientIngest,
  configuredClientIngestKeys,
};
