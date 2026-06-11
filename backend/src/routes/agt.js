/**
 * AGT Integration Routes
 * Handles invoice transmission, signing, and audit logging
 */

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');
const { getAgtConfig, saveAgtConfig } = require('../agt/agtConfig');
const {
  transmitFiscalEntity,
  retryTransmission,
  getEntityAgtStatus,
  ENTITY_MAP,
} = require('../agt/agtTransmission');

module.exports = function(broadcastTable) {
  const router = express.Router();
  const db = require('../db');

  router.get('/config', async (_req, res) => {
    try {
      res.json(await getAgtConfig());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/config', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const saved = await saveAgtConfig(req.body || {});
      res.json(saved);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // ==================== RSA SIGNING (Server-side backup) ====================
  
  /**
   * Sign invoice data
   * POST /api/agt/sign
   */
  router.post('/sign', async (req, res) => {
    try {
      const { invoiceId } = req.body;
      if (!invoiceId) {
        return res.status(400).json({ error: 'invoiceId is required' });
      }
      const { signFiscalEntity } = require('../agt/fiscalSigning');
      const result = await signFiscalEntity('sale', invoiceId);
      if (!result) {
        return res.status(404).json({ error: 'Sale not found' });
      }
      res.json({
        success: true,
        hash: result.contentHash,
        shortHash: result.shortHash,
        algorithm: result.algorithm,
        signatureData: result.signatureData,
      });
    } catch (error) {
      console.error('[AGT] Sign error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== AGT TRANSMISSION ====================

  /**
   * Transmit fiscal document to AGT
   * POST /api/agt/transmit  { entityType, entityId, invoiceId? }
   */
  router.post('/transmit', requireAuth, requirePermission('agt_send'), async (req, res) => {
    try {
      const entityType = req.body.entityType || (req.body.invoiceId ? 'sale' : null);
      const entityId = req.body.entityId || req.body.invoiceId;
      if (!entityType || !entityId) {
        return res.status(400).json({ error: 'entityType and entityId are required' });
      }
      const kind = Object.keys(ENTITY_MAP).find((k) => ENTITY_MAP[k].entityType === entityType)
        || (entityType === 'invoice' ? 'sale' : null);
      if (!kind) {
        return res.status(400).json({ error: `Unsupported entityType: ${entityType}` });
      }

      const result = await transmitFiscalEntity(kind, entityId, {
        force: !!req.body.force,
        documentNumber: req.body.documentNumber || req.body.invoiceNumber,
        invoiceNumber: req.body.invoiceNumber || req.body.documentNumber,
      });
      if (result.skipped) {
        const meta = ENTITY_MAP[kind];
        await logFiscalEventFromReq(req, {
          tableName: meta.table || meta.entityType,
          recordId: result.entityId || entityId,
          action: 'agt_transmit',
          description: `Documento já validado no AGT (${result.agtCode || result.agtStatus || 'ok'})`,
          newValues: { agtCode: result.agtCode, agtStatus: result.agtStatus, skipped: true },
        });
        return res.json({ success: true, skipped: true, ...result });
      }

      const meta = ENTITY_MAP[kind];
      await logAudit(db, {
        userId: req.user?.id,
        userName: req.user?.name,
        action: 'document_transmitted',
        entityType: meta.entityType,
        entityId,
        entityNumber: result.responsePayload?.documentNumber,
        details: { agtCode: result.agtCode, agtStatus: result.agtStatus },
      });

      await logFiscalEventFromReq(req, {
        tableName: meta.table || meta.entityType,
        recordId: entityId,
        action: 'agt_transmit',
        description: `Documento enviado ao AGT (${result.agtCode || result.agtStatus || 'ok'})`,
        newValues: { agtCode: result.agtCode, agtStatus: result.agtStatus, entityType: meta.entityType },
      });

      if (broadcastTable) {
        broadcastTable(meta.table === 'sales' ? 'sales' : meta.table);
      }

      res.json({
        success: true,
        transmissionId: result.transmissionId,
        agtCode: result.agtCode,
        agtStatus: result.agtStatus,
        validatedAt: result.validatedAt,
      });
    } catch (error) {
      console.error('[AGT] Transmit error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/transmit/:entityType/:entityId', requireAuth, requirePermission('agt_send'), async (req, res) => {
    try {
      const kind = Object.keys(ENTITY_MAP).find((k) => ENTITY_MAP[k].entityType === req.params.entityType);
      if (!kind) return res.status(400).json({ error: 'Invalid entityType' });
      const result = await transmitFiscalEntity(kind, req.params.entityId, { force: !!req.body?.force });
      const meta = ENTITY_MAP[kind];
      await logFiscalEventFromReq(req, {
        tableName: meta.table || meta.entityType,
        recordId: req.params.entityId,
        action: 'agt_transmit',
        description: `Documento enviado ao AGT (${result.agtCode || result.agtStatus || 'ok'})`,
        newValues: { agtCode: result.agtCode, agtStatus: result.agtStatus, entityType: meta.entityType },
      });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/retry/:transmissionId', requireAuth, requirePermission('agt_send'), async (req, res) => {
    try {
      const result = await retryTransmission(req.params.transmissionId);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Check AGT status — sale by id (legacy) or /status/:entityType/:entityId
   */
  router.get('/status/:invoiceId', async (req, res) => {
    try {
      const status = await getEntityAgtStatus('sale', req.params.invoiceId, {
        documentNumber: req.query.documentNumber || req.query.invoiceNumber,
        invoiceNumber: req.query.invoiceNumber || req.query.documentNumber,
      });
      res.json({
        agt_status: status.agtStatus,
        agt_code: status.agtCode,
        agt_validated_at: status.agtValidatedAt,
        remote: status.remote,
      });
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.get('/document-status/:entityType/:entityId', async (req, res) => {
    try {
      const kind = Object.keys(ENTITY_MAP).find((k) => ENTITY_MAP[k].entityType === req.params.entityType);
      if (!kind) return res.status(400).json({ error: 'Invalid entityType' });
      const status = await getEntityAgtStatus(kind, req.params.entityId, {
        documentNumber: req.query.documentNumber || req.query.invoiceNumber,
        invoiceNumber: req.query.invoiceNumber || req.query.documentNumber,
      });
      res.json(status);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  /**
   * Void invoice at AGT
   * POST /api/agt/void
   */
  router.post('/void', async (req, res) => {
    try {
      const { invoiceId, reason } = req.body;

      // Get invoice
      const invoiceResult = await db.query(
        'SELECT * FROM sales WHERE id = $1',
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({ error: 'Factura não encontrada' });
      }

      const invoice = invoiceResult.rows[0];

      // Record void transmission
      await db.query(
        `INSERT INTO agt_transmissions 
         (invoice_id, invoice_number, transmission_type, request_payload, agt_status)
         VALUES ($1, $2, 'void', $3, 'validated')`,
        [invoiceId, invoice.invoice_number, JSON.stringify({ reason })]
      );

      // Update sale status
      await db.query(
        `UPDATE sales SET status = 'voided' WHERE id = $1`,
        [invoiceId]
      );

      // Log audit
      await logAudit(db, {
        action: 'invoice_voided',
        entityType: 'invoice',
        entityId: invoiceId,
        entityNumber: invoice.invoice_number,
        details: { reason }
      });

      if (broadcastTable) broadcastTable('sales');

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== AUDIT LOGS ====================

  /**
   * Get audit logs
   * GET /api/agt/audit
   */
  router.get('/audit', async (req, res) => {
    try {
      const { startDate, endDate, action, entityType, limit = 100 } = req.query;

      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];

      if (startDate) {
        params.push(startDate);
        query += ` AND created_at >= $${params.length}`;
      }
      if (endDate) {
        params.push(endDate);
        query += ` AND created_at <= $${params.length}`;
      }
      if (action) {
        params.push(action);
        query += ` AND action = $${params.length}`;
      }
      if (entityType) {
        params.push(entityType);
        query += ` AND entity_type = $${params.length}`;
      }

      params.push(parseInt(limit));
      query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Verify audit chain integrity
   * GET /api/agt/audit/verify
   */
  router.get('/audit/verify', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM audit_logs ORDER BY sequence_number ASC'
      );

      const logs = result.rows;
      let valid = true;
      let brokenAt = null;

      for (let i = 1; i < logs.length; i++) {
        if (logs[i].previous_hash !== logs[i - 1].row_hash) {
          valid = false;
          brokenAt = logs[i].sequence_number;
          break;
        }
      }

      res.json({
        valid,
        totalLogs: logs.length,
        brokenAt,
        message: valid ? 'Integridade da cadeia verificada' : `Cadeia quebrada na sequência ${brokenAt}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Get transmission history
   * GET /api/agt/transmissions
   */
  router.get('/transmissions', async (req, res) => {
    try {
      const { status, limit = 50 } = req.query;

      let query = `
        SELECT t.*,
               COALESCE(t.invoice_number, s.invoice_number) AS document_number,
               s.total AS sale_total,
               s.customer_name
        FROM agt_transmissions t
        LEFT JOIN sales s ON t.invoice_id = s.id
      `;
      const params = [];

      if (status) {
        params.push(status);
        query += ` WHERE t.agt_status = $${params.length}`;
      }

      params.push(parseInt(limit));
      query += ` ORDER BY t.transmitted_at DESC LIMIT $${params.length}`;

      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Log audit event with hash chain
 */
async function logAudit(db, { userId, userName, action, entityType, entityId, entityNumber, details }) {
  // Get last hash
  const lastResult = await db.query(
    'SELECT row_hash FROM audit_logs ORDER BY sequence_number DESC LIMIT 1'
  );
  const previousHash = lastResult.rows[0]?.row_hash || crypto.createHash('sha256').update('GENESIS').digest('hex');

  // Calculate new hash
  const rowData = {
    action,
    entityType,
    entityId,
    entityNumber,
    details,
    timestamp: new Date().toISOString()
  };
  const rowHash = crypto.createHash('sha256')
    .update(JSON.stringify(rowData) + previousHash)
    .digest('hex');

  // Insert log
  await db.query(
    `INSERT INTO audit_logs 
     (user_id, user_name, action, entity_type, entity_id, entity_number, details, previous_hash, row_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, userName, action, entityType, entityId, entityNumber, JSON.stringify(details), previousHash, rowHash]
  );
}
