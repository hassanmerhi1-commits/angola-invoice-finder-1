const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const {
  ALLOWED_ENTITY,
  decodeBase64Payload,
  writeAttachmentFile,
} = require('../lib/attachmentStorage');
const { auditErpSafe } = require('../lib/erpAudit');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

module.exports = function attachmentsRouter(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const entityType = String(req.query.entityType || '').trim();
      const entityId = String(req.query.entityId || '').trim();
      if (!entityType || !entityId) {
        return res.status(400).json({ error: 'entityType and entityId are required' });
      }
      const r = await db.query(
        `SELECT id, entity_type, entity_id, file_name, content_type, byte_size,
                uploaded_by, uploaded_by_name, created_at
         FROM document_attachments
         WHERE entity_type = $1 AND entity_id = $2
         ORDER BY created_at DESC`,
        [entityType, entityId],
      );
      res.json(r.rows.map(mapRow));
    } catch (e) {
      console.error('[ATTACHMENTS]', e);
      res.status(500).json({ error: e.message || 'Failed to list attachments' });
    }
  });

  router.post(
    '/',
    requirePermission('purchase_create', 'expense_create', 'admin_settings', 'invoice_create'),
    async (req, res) => {
      try {
        const entityType = String(req.body?.entityType || '').trim();
        const entityId = String(req.body?.entityId || '').trim();
        const fileName = String(req.body?.fileName || '').trim();
        const contentType = String(req.body?.contentType || 'application/octet-stream').trim();
        if (!ALLOWED_ENTITY.has(entityType)) {
          return res.status(400).json({ error: 'Unsupported entityType' });
        }
        if (!entityId || !fileName) {
          return res.status(400).json({ error: 'entityId and fileName are required' });
        }
        const buffer = decodeBase64Payload(req.body?.dataBase64);
        const written = writeAttachmentFile(entityType, entityId, fileName, buffer);

        const r = await db.query(
          `INSERT INTO document_attachments (
             id, entity_type, entity_id, file_name, content_type, byte_size,
             storage_path, uploaded_by, uploaded_by_name
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, entity_type, entity_id, file_name, content_type, byte_size,
                     uploaded_by, uploaded_by_name, created_at`,
          [
            written.id,
            entityType,
            entityId,
            written.fileName,
            contentType.slice(0, 120),
            written.byteSize,
            written.storagePath,
            req.user?.id || null,
            req.user?.name || req.user?.email || null,
          ],
        );

        await broadcastTable?.('document_attachments', written.id);
        auditErpSafe(req, {
          table: 'document_attachments',
          id: written.id,
          action: 'create',
          description: `Anexo: ${written.fileName} → ${entityType}/${entityId}`,
        });
        res.status(201).json(mapRow(r.rows[0]));
      } catch (e) {
        console.error('[ATTACHMENTS]', e);
        res.status(400).json({ error: e.message || 'Failed to upload attachment' });
      }
    },
  );

  router.get('/:id/download', async (req, res) => {
    try {
      const r = await db.query(
        `SELECT file_name, content_type, storage_path FROM document_attachments WHERE id = $1`,
        [req.params.id],
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Attachment not found' });
      if (!row.storage_path || !fs.existsSync(row.storage_path)) {
        return res.status(404).json({ error: 'Attachment file missing on disk' });
      }
      res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(row.file_name || 'file')}"`,
      );
      fs.createReadStream(row.storage_path).pipe(res);
    } catch (e) {
      console.error('[ATTACHMENTS]', e);
      res.status(500).json({ error: e.message || 'Download failed' });
    }
  });

  router.delete('/:id', requirePermission('admin_settings', 'purchase_create', 'expense_create'), async (req, res) => {
    try {
      const r = await db.query(
        `SELECT id, storage_path, file_name FROM document_attachments WHERE id = $1`,
        [req.params.id],
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Attachment not found' });
      await db.query('DELETE FROM document_attachments WHERE id = $1', [req.params.id]);
      try {
        if (row.storage_path && fs.existsSync(row.storage_path)) fs.unlinkSync(row.storage_path);
      } catch (_) { /* ignore */ }
      await broadcastTable?.('document_attachments', req.params.id);
      auditErpSafe(req, {
        table: 'document_attachments',
        id: req.params.id,
        action: 'delete',
        description: `Anexo removido: ${row.file_name || req.params.id}`,
      });
      res.json({ success: true });
    } catch (e) {
      console.error('[ATTACHMENTS]', e);
      res.status(500).json({ error: e.message || 'Failed to delete attachment' });
    }
  });

  return router;
};
