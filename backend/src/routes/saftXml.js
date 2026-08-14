// SAF-T AO XML Export — uses unified generator
const express = require('express');
const { generateSaft } = require('../saft/saftGenerator');
const { saftToXml, buildSaftFilename } = require('../saft/saftXmlSerializer');

module.exports = function saftXmlRouter() {
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

  router.get('/download', async (req, res) => {
    try {
      const { saft, company, period } = await generateSaft(parseOptions(req));
      const xml = saftToXml(saft);
      const filename = buildSaftFilename(company, period, 'xml');

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error('[SAF-T XML ERROR]', error);
      res.status(500).json({ error: 'Failed to generate SAF-T XML' });
    }
  });

  router.post('/download', async (req, res) => {
    try {
      const { saft, company, period } = await generateSaft(parseOptions(req));
      const xml = saftToXml(saft);
      const filename = buildSaftFilename(company, period, 'xml');

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error('[SAF-T XML ERROR]', error);
      res.status(500).json({ error: 'Failed to generate SAF-T XML' });
    }
  });

  return router;
};
