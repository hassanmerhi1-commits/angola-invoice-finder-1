const express = require('express');
const { getCompanySettings, saveCompanySettings } = require('../agt/companySettings');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

module.exports = function companySettingsRouter(broadcastTable) {
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

  router.put('/', requirePermission('admin_settings'), async (req, res) => {
    try {
      const settings = await saveCompanySettings(req.body || {});
      // Notify all connected LAN clients so they refetch the shared company profile.
      if (typeof broadcastTable === 'function') {
        try { broadcastTable('company_settings'); } catch (_) { /* non-fatal */ }
      }
      auditErpSafe(req, {
        table: 'company_settings',
        id: 'company',
        action: 'update',
        description: 'Definições da empresa actualizadas',
        newValues: {
          name: settings?.name || settings?.companyName,
          nif: settings?.nif || settings?.taxId,
        },
      });
      res.json({ data: settings });
    } catch (error) {
      console.error('[COMPANY SETTINGS]', error);
      res.status(500).json({ error: 'Failed to save company settings' });
    }
  });

  return router;
};
