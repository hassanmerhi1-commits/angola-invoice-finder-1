// Deployment / database trust — Phase A
const express = require('express');
const db = require('../db');
const { buildDeploymentStatus } = require('../lib/deploymentStatus');

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

  return router;
};
