/**
 * AGT Phase 10 — security status and session log API.
 */
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { getSecurityStatus } = require('../lib/securityStatus');
const { listSessions } = require('../lib/sessionLog');

module.exports = function securityRoutes() {
  const router = express.Router();

  router.get('/status', requireAuth, requirePermission('admin_settings'), async (_req, res) => {
    try {
      res.json(await getSecurityStatus());
    } catch (error) {
      console.error('[SECURITY] status:', error);
      res.status(500).json({ error: error.message || 'Failed to load security status' });
    }
  });

  router.get('/sessions', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const activeOnly = req.query.active === 'true' || req.query.active === '1';
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const userId = req.query.userId || null;
      const rows = await listSessions({ limit, activeOnly, userId });
      res.json(rows);
    } catch (error) {
      console.error('[SECURITY] sessions:', error);
      res.status(500).json({ error: error.message || 'Failed to list sessions' });
    }
  });

  return router;
};
