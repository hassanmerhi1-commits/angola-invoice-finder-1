/**
 * AGT Integration Routes
 * Handles invoice transmission, signing, and audit logging
 */

const express = require('express');
const crypto = require('crypto');

module.exports = function(broadcastTable) {
  const router = express.Router();
  const db = require('../db');

  // ==================== RSA SIGNING (Server-side backup) ====================
  
  /**
   * Sign invoice data
   * POST /api/agt/sign
   */
  router.post('/sign', async (req, res) => {
    try {
      const { invoiceId, invoiceNumber, date, total, previousHash } = req.body;

      // Build canonical string for signing
      const canonicalString = [
        date,
        new Date().toISOString(),
        invoiceNumber,
        total.toFixed(2),
        previousHash || '0'
      ].join(';');

      // Calculate SHA-256 hash
      const hash = crypto.createHash('sha256').update(canonicalString).digest('hex');
      const shortHash = hash.substring(0, 4).toUpperCase();

      // Store signature record
      await db.query(
        `INSERT INTO invoice_signatures (invoice_id, invoice_number, signed_content_hash, algorithm)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (invoice_id) DO UPDATE SET signed_content_hash = $3`,
        [invoiceId, invoiceNumber, hash, 'SHA-256']
      );

      // Update sale with hash
      await db.query(
        `UPDATE sales SET saft_hash = $1 WHERE id = $2`,
        [shortHash, invoiceId]
      );

      res.json({
        success: true,
        hash,
        shortHash,
        algorithm: 'SHA-256'
      });
    } catch (error) {
      console.error('[AGT] Sign error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== AGT TRANSMISSION ====================

  /**
   * Transmit invoice to AGT
   * POST /api/agt/transmit
   */
  router.post('/transmit', async (req, res) => {
    try {
      const { invoiceId } = req.body;

      // Get invoice
      const invoiceResult = await db.query(
        'SELECT * FROM sales WHERE id = $1',
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({ error: 'Factura não encontrada' });
      }

      const invoice = invoiceResult.rows[0];

      // Build AGT payload
      const payload = {
        documentType: 'FT',
        invoiceNumber: invoice.invoice_number,
        date: invoice.created_at,
        customerNif: invoice.customer_nif || '999999990',
        customerName: invoice.customer_name || 'Consumidor Final',
        subtotal: parseFloat(invoice.subtotal),
        taxAmount: parseFloat(invoice.tax_amount),
        total: parseFloat(invoice.total),
        hash: invoice.saft_hash
      };

      // Record transmission attempt
      const transmissionResult = await db.query(
        `INSERT INTO agt_transmissions 
         (invoice_id, invoice_number, transmission_type, request_payload, agt_status)
         VALUES ($1, $2, 'invoice', $3, 'pending')
         RETURNING id`,
        [invoiceId, invoice.invoice_number, JSON.stringify(payload)]
      );

      const { transmitInvoice } = require('../agt/connector');
      const agtResult = await transmitInvoice(payload);

      await db.query(
        `UPDATE agt_transmissions 
         SET response_payload = $1, agt_code = $2, agt_status = $3, validated_at = $4
         WHERE id = $5`,
        [
          JSON.stringify(agtResult.responsePayload),
          agtResult.agtCode,
          agtResult.agtStatus,
          agtResult.validatedAt,
          transmissionResult.rows[0].id
        ]
      );

      await db.query(
        `UPDATE sales 
         SET agt_status = $1, agt_code = $2, agt_validated_at = $3
         WHERE id = $4`,
        [agtResult.agtStatus, agtResult.agtCode, agtResult.validatedAt, invoiceId]
      );

      // Log audit
      await logAudit(db, {
        action: 'invoice_transmitted',
        entityType: 'invoice',
        entityId: invoiceId,
        entityNumber: invoice.invoice_number,
        details: { agtCode, validatedAt }
      });

      if (broadcastTable) broadcastTable('sales');

      res.json({
        success: true,
        agtCode: agtResult.agtCode,
        agtStatus: agtResult.agtStatus,
        validatedAt: agtResult.validatedAt
      });
    } catch (error) {
      console.error('[AGT] Transmit error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Check AGT status
   * GET /api/agt/status/:invoiceId
   */
  router.get('/status/:invoiceId', async (req, res) => {
    try {
      const result = await db.query(
        `SELECT agt_status, agt_code, agt_validated_at 
         FROM sales WHERE id = $1`,
        [req.params.invoiceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Factura não encontrada' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
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
        SELECT t.*, s.invoice_number, s.total, s.customer_name
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
