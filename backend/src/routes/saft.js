// SAF-T AO Backend Export Route — unified generator
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');
const { generateSaft, generateSaftPreview } = require('../saft/saftGenerator');
const { saftToXml, buildSaftFilename } = require('../saft/saftXmlSerializer');
const { saveCompanySettings } = require('../agt/companySettings');

module.exports = function saftRouter() {
  const router = express.Router();

  function parseOptions(req) {
    const src = { ...req.query, ...(req.body || {}) };
    const { year, startDate, endDate, branchId, includeVoided } = src;
    return {
      year,
      startDate,
      endDate,
      branchId: branchId || undefined,
      includeVoided: includeVoided === true || includeVoided === 'true' || includeVoided === '1',
      companyOverride: req.body?.company,
    };
  }

  async function auditSaftExport(req, period, format) {
    await logFiscalEventFromReq(req, {
      tableName: 'saft',
      action: 'saft_export',
      description: `SAF-T export (${format}) ${period?.startDate || ''} – ${period?.endDate || ''}`.trim(),
      metadata: { format, period },
    });
  }

  // Generate SAF-T AO JSON (backward compatible)
  router.get('/generate', requireAuth, requirePermission('saft_export'), async (req, res) => {
    try {
      const { saft, period } = await generateSaft(parseOptions(req));
      await auditSaftExport(req, period, 'json');
      res.json(saft);
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to generate SAF-T export' });
    }
  });

  router.post('/generate', requireAuth, requirePermission('saft_export'), async (req, res) => {
    try {
      if (req.body?.company) {
        await saveCompanySettings(req.body.company);
      }
      const { saft, period } = await generateSaft(parseOptions(req));
      await auditSaftExport(req, period, 'json');
      res.json(saft);
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to generate SAF-T export' });
    }
  });

  router.get('/preview', requireAuth, requirePermission('saft_export'), async (req, res) => {
    try {
      const preview = await generateSaftPreview(parseOptions(req));
      res.json({ data: preview });
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch SAF-T preview' });
    }
  });

  router.get('/export', requireAuth, requirePermission('saft_export'), async (req, res) => {
    try {
      const format = (req.query.format || 'json').toLowerCase();
      const { saft, company, period } = await generateSaft(parseOptions(req));
      await auditSaftExport(req, period, format);

      if (format === 'xml') {
        const xml = saftToXml(saft);
        const filename = buildSaftFilename(company, period, 'xml');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(xml);
      }

      const filename = buildSaftFilename(company, period, 'json');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(saft);
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to export SAF-T file' });
    }
  });

  router.post('/export', requireAuth, requirePermission('saft_export'), async (req, res) => {
    try {
      if (req.body?.company) {
        await saveCompanySettings(req.body.company);
      }
      const format = (req.query.format || req.body?.format || 'json').toLowerCase();
      const { saft, company, period } = await generateSaft(parseOptions(req));
      await auditSaftExport(req, period, format);

      if (format === 'xml') {
        const xml = saftToXml(saft);
        const filename = buildSaftFilename(company, period, 'xml');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(xml);
      }

      res.json({ data: saft, filename: buildSaftFilename(company, period, 'json') });
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to export SAF-T file' });
    }
  });

  router.get('/summary', requireAuth, requirePermission('saft_export'), async (req, res) => {
    try {
      const year = req.query.year || new Date().getFullYear();
      const preview = await generateSaftPreview({
        year,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        branchId: req.query.branchId,
      });
      res.json({
        year,
        sales: preview.sales,
        creditNotes: preview.creditNotes,
        debitNotes: preview.debitNotes,
        payments: preview.payments,
        journalEntries: preview.journalEntries,
        stockMovements: preview.stockMovements,
      });
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch summary' });
    }
  });

  return router;
};
