const express = require('express');
const { getCompanySettings, saveCompanySettings } = require('../agt/companySettings');

module.exports = function companySettingsRouter() {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const settings = await getCompanySettings();
      res.json({ data: settings });
    } catch (error) {
      console.error('[COMPANY SETTINGS]', error);
      res.status(500).json({ error: 'Failed to load company settings' });
    }
  });

  router.put('/', async (req, res) => {
    try {
      const settings = await saveCompanySettings(req.body || {});
      res.json({ data: settings });
    } catch (error) {
      console.error('[COMPANY SETTINGS]', error);
      res.status(500).json({ error: 'Failed to save company settings' });
    }
  });

  return router;
};
