/**
 * AGT Phase 12 — certification readiness API.
 */
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { getCertificationStatus } = require('../lib/certificationStatus');

module.exports = function certificationRoutes() {
  const router = express.Router();

  router.get('/status', requireAuth, requirePermission('admin_settings'), async (_req, res) => {
    try {
      res.json(await getCertificationStatus());
    } catch (error) {
      console.error('[CERTIFICATION] status:', error);
      res.status(500).json({ error: error.message || 'Failed to load certification status' });
    }
  });

  return router;
};
