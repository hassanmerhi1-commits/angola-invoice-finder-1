// Workflow Approval API Routes
const express = require('express');
const db = require('../db');
const { auditErpSafe } = require('../lib/erpAudit');
const { requirePermission } = require('../middleware/requirePermission');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // ===== WORKFLOWS =====
  router.get('/workflows', async (req, res) => {
    try {
      const { documentType } = req.query;
      let query = 'SELECT * FROM approval_workflows WHERE is_active = true';
      const params = [];
      if (documentType) {
        params.push(documentType);
        query += ` AND document_type = $1`;
      }
      query += ' ORDER BY document_type, min_amount';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('[APPROVAL ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch workflows' });
    }
  });

  router.post('/workflows', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { name, documentType, minAmount, maxAmount, steps } = req.body;
      const result = await db.query(
        `INSERT INTO approval_workflows (name, document_type, min_amount, max_amount, steps)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, documentType, minAmount || 0, maxAmount, JSON.stringify(steps)]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[APPROVAL ERROR]', error);
      res.status(500).json({ error: 'Failed to create workflow' });
    }
  });

  // ===== APPROVAL REQUESTS =====
  router.get('/requests', async (req, res) => {
    try {
      const { status, documentType, branchId } = req.query;
      const params = [];
      const conditions = [];

      if (status) { params.push(status); conditions.push(`ar.status = $${params.length}`); }
      if (documentType) { params.push(documentType); conditions.push(`ar.document_type = $${params.length}`); }
      if (branchId) { params.push(branchId); conditions.push(`ar.branch_id = $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await db.query(
        `SELECT ar.*, aw.name as workflow_name
         FROM approval_requests ar
         LEFT JOIN approval_workflows aw ON aw.id = ar.workflow_id
         ${where} ORDER BY ar.created_at DESC`,
        params
      );

      // Get actions for each request
      for (const req of result.rows) {
        const actions = await db.query(
          'SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_number, created_at',
          [req.id]
        );
        req.actions = actions.rows;
      }

      res.json(result.rows);
    } catch (error) {
      console.error('[APPROVAL ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch approval requests' });
    }
  });

  // Submit for approval
  router.post('/requests', requirePermission('purchase_create', 'accounting_create'), async (req, res) => {
    try {
      const { documentType, documentId, documentNumber, amount, requestedBy, requestedByName, branchId, notes } = req.body;

      // Find matching workflow
      const workflowResult = await db.query(
        `SELECT * FROM approval_workflows 
         WHERE document_type = $1 AND is_active = true AND min_amount <= $2 
         AND (max_amount IS NULL OR max_amount >= $2)
         ORDER BY min_amount DESC LIMIT 1`,
        [documentType, amount || 0]
      );

      const workflow = workflowResult.rows[0];
      if (!workflow) {
        return res.status(400).json({ error: 'No matching approval workflow found' });
      }

      const steps = typeof workflow.steps === 'string' ? JSON.parse(workflow.steps) : workflow.steps;

      const result = await db.query(
        `INSERT INTO approval_requests 
         (workflow_id, document_type, document_id, document_number, amount, total_steps, 
          requested_by, requested_by_name, branch_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [workflow.id, documentType, documentId, documentNumber, amount,
         steps.length, requestedBy, requestedByName, branchId, notes]
      );

      broadcastTable('approval_requests');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[APPROVAL ERROR]', error);
      res.status(500).json({ error: 'Failed to submit approval request' });
    }
  });

  // Approve or reject
  router.post('/requests/:id/:action', requirePermission('admin_settings', 'purchase_create', 'accounting_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id, action } = req.params;
      const { userId, userName, comments } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
      }

      // Get request
      const reqResult = await client.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
      const request = reqResult.rows[0];
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

      // Record action
      await client.query(
        `INSERT INTO approval_actions (request_id, step_number, action, user_id, user_name, comments)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, request.current_step, action, userId, userName, comments || '']
      );

      if (action === 'reject') {
        await client.query(
          `UPDATE approval_requests SET status = 'rejected', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id]
        );
      } else if (request.current_step >= request.total_steps) {
        // Final approval
        await client.query(
          `UPDATE approval_requests SET status = 'approved', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id]
        );
        if (request.document_type === 'purchase_order' && request.document_id) {
          try {
            if (userId && /^[0-9a-f-]{36}$/i.test(String(userId))) {
              await client.query(
                `UPDATE purchase_orders
                 SET status = 'approved', approved_by = $1::uuid, approved_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND status IN ('awaiting_approval', 'pending')`,
                [userId, request.document_id],
              );
            } else {
              await client.query(
                `UPDATE purchase_orders
                 SET status = 'approved', approved_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status IN ('awaiting_approval', 'pending')`,
                [request.document_id],
              );
            }
            broadcastTable('purchase_orders');
          } catch (poErr) {
            console.warn('[APPROVAL] purchase_orders status sync skipped:', poErr.message);
          }
        }
      } else {
        // Move to next step
        await client.query(
          `UPDATE approval_requests SET current_step = current_step + 1 WHERE id = $1`,
          [id]
        );
      }

      await client.query('COMMIT');
      broadcastTable('approval_requests');

      const updated = await db.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
      auditErpSafe(req, {
        table: 'approval_requests',
        id,
        action,
        description: `Aprovação ${action}: ${request.document_type || ''} ${request.document_number || request.document_id || id}`,
        newValues: {
          status: updated.rows[0]?.status,
          documentType: request.document_type,
          documentId: request.document_id,
          userName,
          comments,
        },
      });
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[APPROVAL ERROR]', error);
      res.status(500).json({ error: 'Failed to process approval' });
    } finally {
      client.release();
    }
  });

  // Pending count (for badges)
  router.get('/pending-count', async (req, res) => {
    try {
      const result = await db.query(
        `SELECT document_type, COUNT(*) as count FROM approval_requests WHERE status = 'pending' GROUP BY document_type`
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch pending count' });
    }
  });

  return router;
};
