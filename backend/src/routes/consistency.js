// Data integrity / consistency checks and repair (Settings UI)
const express = require('express');
const db = require('../db');
const path = require('path');
const { runAllChecksReport } = require(path.join(__dirname, '../../scripts/lib/integrityRunner'));
const { runDataConsistencyRepair } = require('../dataConsistencyRepair');
const { requireAdmin } = require('../middleware/requireAdmin');

module.exports = function consistencyRoutes(broadcastTable) {
  const router = express.Router();

  router.use(requireAdmin);

  router.get('/check', async (_req, res) => {
    try {
      const report = await runAllChecksReport(db, { uniqueness: true, consistency: true });
      res.json({
        ...report,
        engine: db.engine,
        databasePath: db.engine === 'sqlite' ? db.dbPath : null,
      });
    } catch (error) {
      console.error('[CONSISTENCY] check:', error);
      res.status(500).json({ error: error.message || 'Consistency check failed' });
    }
  });

  router.post('/repair', async (_req, res) => {
    try {
      const repair = await runDataConsistencyRepair();
      const check = await runAllChecksReport(db, { uniqueness: true, consistency: true });

      if (broadcastTable) {
        await broadcastTable('suppliers');
        await broadcastTable('clients');
        await broadcastTable('products');
      }

      res.json({
        repair,
        check: {
          ...check,
          engine: db.engine,
          databasePath: db.engine === 'sqlite' ? db.dbPath : null,
        },
      });
    } catch (error) {
      console.error('[CONSISTENCY] repair:', error);
      res.status(500).json({ error: error.message || 'Consistency repair failed' });
    }
  });

  return router;
};
