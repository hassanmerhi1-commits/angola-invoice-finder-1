// Deployment / database trust — Phase A
const express = require('express');
const db = require('../db');
const { buildDeploymentStatus } = require('../lib/deploymentStatus');
const { requirePermission } = require('../middleware/requirePermission');

module.exports = function deploymentRoutes() {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      const status = await buildDeploymentStatus(db);
      res.json(status);
    } catch (error) {
      console.error('[DEPLOYMENT]', error);
      res.status(500).json({ ok: false, error: error.message || 'Failed to read deployment status' });
    }
  });

  router.get('/update/status', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { buildUpdateStatus } = require('../lib/serverUpdate');
      const refresh = req.query.refresh !== '0' && req.query.refresh !== 'false';
      const status = await buildUpdateStatus(db, { refreshLatest: refresh });
      res.json(status);
    } catch (error) {
      console.error('[DEPLOYMENT update/status]', error);
      res.status(500).json({ ok: false, error: error.message || 'Failed to read update status' });
    }
  });

  router.post('/update/apply', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { startServerUpdate } = require('../lib/serverUpdate');
      const job = await startServerUpdate(db, {
        confirm: req.body?.confirm === true,
        user: req.user,
      });
      res.status(202).json({ ok: true, job });
    } catch (error) {
      const code = error.code || '';
      const status =
        code === 'CONFIRM_REQUIRED' ? 400
          : code === 'NOT_ELIGIBLE' ? 403
            : code === 'UPDATE_IN_PROGRESS' ? 409
              : 500;
      console.error('[DEPLOYMENT update/apply]', error);
      res.status(status).json({ ok: false, error: error.message || 'Update failed' });
    }
  });

  router.post('/repair-schema', requirePermission('admin_settings'), async (_req, res) => {
    try {
      const { ensureSalesCreditPaymentMethod, ensureBranchPricingColumn } = require('../lib/ensurePhaseSchema');
      const { buildSchemaChecks } = require('../lib/schemaChecks');
      await ensureSalesCreditPaymentMethod(db);
      await ensureBranchPricingColumn(db);
      const schemaChecks = await buildSchemaChecks(db);
      res.json({ ok: schemaChecks.ok, schemaChecks });
    } catch (error) {
      console.error('[DEPLOYMENT repair-schema]', error);
      res.status(500).json({ ok: false, error: error.message || 'Schema repair failed' });
    }
  });

  return router;
};
