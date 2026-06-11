const express = require('express');
const {
  importCertificate,
  activateCertificate,
  deleteCertificate,
} = require('../agt/certificateStore');
const { getSigningStatus, verifyFiscalEntity } = require('../agt/fiscalSigning');
const { requireAuth } = require('../middleware/requireAuth');

module.exports = function signingRouter() {
  const router = express.Router();

  router.get('/status', async (_req, res) => {
    try {
      res.json(await getSigningStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/certificates', async (_req, res) => {
    try {
      const status = await getSigningStatus();
      res.json(status.certificates);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/certificates', requireAuth, async (req, res) => {
    try {
      const { alias, pfxBase64, passphrase, certificateNumber } = req.body || {};
      const imported = await importCertificate({
        alias,
        pfxBase64,
        passphrase,
        certificateNumber,
      });
      res.status(201).json(imported);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/certificates/:id/activate', requireAuth, async (req, res) => {
    try {
      res.json(await activateCertificate(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/certificates/:id', requireAuth, async (req, res) => {
    try {
      res.json(await deleteCertificate(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/verify/:entityType/:entityId', async (req, res) => {
    try {
      res.json(await verifyFiscalEntity(req.params.entityType, req.params.entityId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
