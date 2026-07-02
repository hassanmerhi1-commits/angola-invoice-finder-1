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
