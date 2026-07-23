const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const {
  getInstallationConfig,
  ensureDefaultInstallation,
  upsertCityFromLocation,
  invalidateInstallationCache,
  generateApiKey,
} = require('../sync/installation');

function isLoopbackRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function syntheticSetupUser() {
  return {
    id: 'system-setup',
    email: 'setup@localhost',
    name: 'Setup',
    role: 'admin',
    branchId: null,
    permissionOverrides: null,
  };
}

/**
 * Setup often runs before login (Electron) and may call via LAN IP, not loopback.
 * Allow: loopback, authenticated admin, or one-time bootstrap when no row exists yet.
 * After an installation exists, LAN anonymous register is blocked.
 */
function requireAdminOrSetupBootstrap(expectedRole) {
  return async (req, res, next) => {
    if (isLoopbackRequest(req)) {
      req.user = syntheticSetupUser();
      req.installationSetupTrusted = true;
      return next();
    }

    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ') && header.length > 8) {
      return requireAuth(req, res, (err) => {
        if (err) return next(err);
        if (req.user?.role !== 'admin') {
          return res.status(403).json({ error: 'Administrator access required' });
        }
        req.installationSetupTrusted = true;
        return next();
      });
    }

    try {
      const existing = await db.query(
        `SELECT id FROM installations WHERE role = $1 LIMIT 1`,
        [expectedRole],
      );
      if (existing.rows.length === 0) {
        req.user = syntheticSetupUser();
        req.installationSetupTrusted = true;
        req.installationBootstrap = true;
        return next();
      }
    } catch (e) {
      console.warn('[INSTALLATIONS] bootstrap check:', e.message);
    }

    return res.status(401).json({
      error: 'Authentication required for installation registration',
      hint: 'Sign in as admin, or run setup from the server PC (loopback).',
    });
  };
}

function mayReturnApiKey(req) {
  return isLoopbackRequest(req) || req.user?.role === 'admin' || req.installationBootstrap === true;
}

module.exports = function installationsRouter() {
  const router = express.Router();

  router.get('/config', requireAuth, async (_req, res) => {
    try {
      const cfg = await getInstallationConfig(true);
      res.json({
        id: cfg.id,
        role: cfg.role,
        cityId: cfg.cityId,
        branchId: cfg.branchId,
        mainApiUrl: cfg.mainApiUrl,
        hasApiKey: !!cfg.apiKey,
        isMainServer: cfg.isMainServer,
        isCityServer: cfg.isCityServer,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/register-city', requireAdminOrSetupBootstrap('city_server'), async (req, res) => {
    try {
      const { province, municipio, mainApiUrl, branchId, nodeRole } = req.body;
      const cityId = await upsertCityFromLocation(province, municipio);

      if (branchId && cityId) {
        await db.query(
          `UPDATE branches SET city_id = $1, node_role = $2 WHERE id = $3`,
          [cityId, nodeRole || 'city_hub', branchId]
        );
      }

      let inst = await ensureDefaultInstallation({
        role: 'city_server',
        cityId,
        branchId,
        mainApiUrl: mainApiUrl || null,
        name: municipio ? `City ${municipio}` : 'City Server',
      });

      if (inst?.id && mainApiUrl) {
        await db.query(
          `UPDATE installations SET main_api_url = $1, city_id = $2, role = 'city_server', updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [mainApiUrl, cityId, inst.id]
        );
      }

      invalidateInstallationCache();
      const payload = {
        success: true,
        cityId,
        installationId: inst?.id,
      };
      if (mayReturnApiKey(req)) {
        payload.apiKey = inst?.api_key;
      }
      res.json(payload);
    } catch (e) {
      console.error('[INSTALLATIONS]', e);
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/register-main', requireAdminOrSetupBootstrap('main_server'), async (req, res) => {
    try {
      const mainBranch = await db.query(
        `SELECT id FROM branches WHERE is_main = 1 OR is_main = true LIMIT 1`
      );
      const branchId = mainBranch.rows[0]?.id;
      if (branchId) {
        await db.query(`UPDATE branches SET node_role = 'main' WHERE id = $1`, [branchId]);
      }
      const inst = await ensureDefaultInstallation({
        role: 'main_server',
        branchId,
        name: 'Main HQ',
        apiKey: req.body.apiKey || generateApiKey(),
      });
      invalidateInstallationCache();
      const payload = { success: true, installationId: inst?.id };
      if (mayReturnApiKey(req)) {
        payload.apiKey = inst?.api_key;
      }
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/cities', requireAuth, async (_req, res) => {
    try {
      const r = await db.query('SELECT * FROM cities WHERE is_active IS NOT FALSE ORDER BY name');
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
