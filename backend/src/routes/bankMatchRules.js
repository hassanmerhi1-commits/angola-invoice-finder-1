const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');

const MATCH_FIELDS = new Set(['description', 'reference']);

function mapRule(row) {
  return {
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    matchField: row.match_field || 'description',
    entityType: row.entity_type || null,
    entityHint: row.entity_hint || null,
    priority: Number(row.priority) || 100,
    isActive: row.is_active !== false && row.is_active !== 0,
    createdAt: row.created_at,
  };
}

module.exports = function bankMatchRulesRouter() {
  const router = express.Router();

  router.get('/', requireAuth, async (_req, res) => {
    try {
      const r = await db.query(
        `SELECT * FROM bank_match_rules ORDER BY priority ASC, name ASC`,
      );
      res.json((r.rows || []).map(mapRule));
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.json([]);
      }
      console.error('[BANK_MATCH_RULES]', e);
      res.status(500).json({ error: e.message || 'Failed to list bank match rules' });
    }
  });

  router.post('/', requireAuth, requirePermission('admin_settings', 'bank_manage'), async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const pattern = String(req.body?.pattern || '').trim();
      const matchField = String(req.body?.matchField || req.body?.match_field || 'description').trim();
      const priority = Number(req.body?.priority ?? 100);
      const isActive = req.body?.isActive !== false;
      if (!name || !pattern) {
        return res.status(400).json({ error: 'name and pattern are required' });
      }
      if (!MATCH_FIELDS.has(matchField)) {
        return res.status(400).json({ error: 'matchField must be description or reference' });
      }
      try {
        // Validate regex early so bad rules never break auto-match
        // eslint-disable-next-line no-new
        new RegExp(pattern, 'i');
      } catch {
        return res.status(400).json({ error: 'Invalid regular expression pattern' });
      }
      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO bank_match_rules
           (id, name, pattern, match_field, entity_type, entity_hint, priority, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          name,
          pattern,
          matchField,
          req.body?.entityType ? String(req.body.entityType).trim() : null,
          req.body?.entityHint ? String(req.body.entityHint).trim() : null,
          Number.isFinite(priority) ? priority : 100,
          isActive,
        ],
      );
      const r = await db.query('SELECT * FROM bank_match_rules WHERE id = $1', [id]);
      res.status(201).json(mapRule(r.rows[0]));
    } catch (e) {
      console.error('[BANK_MATCH_RULES]', e);
      res.status(500).json({ error: e.message || 'Failed to create rule' });
    }
  });

  router.put('/:id', requireAuth, requirePermission('admin_settings', 'bank_manage'), async (req, res) => {
    try {
      const existing = await db.query('SELECT * FROM bank_match_rules WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Rule not found' });
      const row = existing.rows[0];
      const name = req.body?.name != null ? String(req.body.name).trim() : row.name;
      const pattern = req.body?.pattern != null ? String(req.body.pattern).trim() : row.pattern;
      const matchField = req.body?.matchField != null || req.body?.match_field != null
        ? String(req.body.matchField || req.body.match_field).trim()
        : row.match_field;
      const priority = req.body?.priority != null ? Number(req.body.priority) : row.priority;
      const isActive = req.body?.isActive != null
        ? req.body.isActive !== false
        : (row.is_active !== false && row.is_active !== 0);
      if (!name || !pattern) {
        return res.status(400).json({ error: 'name and pattern are required' });
      }
      if (!MATCH_FIELDS.has(matchField)) {
        return res.status(400).json({ error: 'matchField must be description or reference' });
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, 'i');
      } catch {
        return res.status(400).json({ error: 'Invalid regular expression pattern' });
      }
      await db.query(
        `UPDATE bank_match_rules
         SET name = $2, pattern = $3, match_field = $4, priority = $5, is_active = $6,
             entity_type = $7, entity_hint = $8
         WHERE id = $1`,
        [
          req.params.id,
          name,
          pattern,
          matchField,
          Number.isFinite(priority) ? priority : 100,
          isActive,
          req.body?.entityType != null ? String(req.body.entityType).trim() : row.entity_type,
          req.body?.entityHint != null ? String(req.body.entityHint).trim() : row.entity_hint,
        ],
      );
      const r = await db.query('SELECT * FROM bank_match_rules WHERE id = $1', [req.params.id]);
      res.json(mapRule(r.rows[0]));
    } catch (e) {
      console.error('[BANK_MATCH_RULES]', e);
      res.status(500).json({ error: e.message || 'Failed to update rule' });
    }
  });

  router.delete('/:id', requireAuth, requirePermission('admin_settings', 'bank_manage'), async (req, res) => {
    try {
      const r = await db.query('DELETE FROM bank_match_rules WHERE id = $1 RETURNING id', [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Rule not found' });
      res.json({ success: true, id: r.rows[0].id });
    } catch (e) {
      console.error('[BANK_MATCH_RULES]', e);
      res.status(500).json({ error: e.message || 'Failed to delete rule' });
    }
  });

  return router;
};
