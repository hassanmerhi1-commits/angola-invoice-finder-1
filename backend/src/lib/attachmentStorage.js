/**
 * Store uploaded attachment bytes under NEXOR data/attachments.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = Number(process.env.ATTACHMENT_MAX_BYTES || 5 * 1024 * 1024);
const ALLOWED_ENTITY = new Set([
  'purchase_invoice',
  'expense',
  'supplier',
  'client',
  'sale',
]);

function attachmentsRoot() {
  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const dir = path.join(installDir, 'data', 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\- ()[\]]+/g, '_');
  return base.slice(0, 180) || 'file';
}

function decodeBase64Payload(dataBase64) {
  const raw = String(dataBase64 || '');
  const comma = raw.indexOf(',');
  const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('Empty attachment payload');
  if (buf.length > MAX_BYTES) {
    throw new Error(`Attachment exceeds max size of ${MAX_BYTES} bytes`);
  }
  return buf;
}

function writeAttachmentFile(entityType, entityId, fileName, buffer) {
  const safeEntity = String(entityType).replace(/[^\w-]+/g, '_');
  const safeId = String(entityId).replace(/[^\w-]+/g, '_');
  const dir = path.join(attachmentsRoot(), safeEntity, safeId);
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const safeName = sanitizeFileName(fileName);
  const storageName = `${id}_${safeName}`;
  const fullPath = path.join(dir, storageName);
  fs.writeFileSync(fullPath, buffer);
  return { id, storagePath: fullPath, byteSize: buffer.length, fileName: safeName };
}

function assertPathInAttachmentsRoot(storagePath) {
  const root = path.resolve(attachmentsRoot());
  const resolved = path.resolve(String(storagePath || ''));
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid attachment storage path');
  }
  return resolved;
}

module.exports = {
  MAX_BYTES,
  ALLOWED_ENTITY,
  attachmentsRoot,
  sanitizeFileName,
  decodeBase64Payload,
  writeAttachmentFile,
  assertPathInAttachmentsRoot,
};
