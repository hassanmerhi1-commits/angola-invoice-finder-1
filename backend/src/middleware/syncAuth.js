const db = require('../db');

async function authenticateSyncIngest(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-sync-api-key'] || '').trim();
  const envKey = (process.env.NEXOR_SYNC_API_KEY || '').trim();

  if (envKey && token === envKey) {
    req.syncAuth = { source: 'env' };
    return next();
  }

  try {
    const r = await db.query(
      `SELECT id, role, city_id, branch_id FROM installations
       WHERE api_key = $1 AND (is_active IS NOT FALSE AND is_active != 0) LIMIT 1`,
      [token]
    );
    if (r.rows.length > 0) {
      req.syncAuth = { source: 'installation', installation: r.rows[0] };
      return next();
    }
  } catch (_) {
    /* installations table may not exist yet */
  }

  return res.status(401).json({ error: 'Invalid sync API key' });
}

module.exports = { authenticateSyncIngest };
