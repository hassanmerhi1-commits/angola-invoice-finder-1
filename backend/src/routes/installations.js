const express = require('express');
const db = require('../db');
const {
  getInstallationConfig,
  ensureDefaultInstallation,
  upsertCityFromLocation,
  invalidateInstallationCache,
  generateApiKey,
} = require('../sync/installation');

module.exports = function installationsRouter() {
  const router = express.Router();

  router.get('/config', async (_req, res) => {
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

  router.post('/register-city', async (req, res) => {
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
      res.json({
        success: true,
        cityId,
        installationId: inst?.id,
        apiKey: inst?.api_key,
      });
    } catch (e) {
      console.error('[INSTALLATIONS]', e);
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/register-main', async (req, res) => {
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
      res.json({ success: true, installationId: inst?.id, apiKey: inst?.api_key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/cities', async (_req, res) => {
    try {
      const r = await db.query('SELECT * FROM cities WHERE is_active IS NOT FALSE ORDER BY name');
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
